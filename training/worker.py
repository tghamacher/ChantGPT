"""Training on this computer's GPU, with no one at the keyboard: the worker watches the repository's `jobs` branch for
jobs (queued by whoever is running the training, Claude included), runs them, and pushes back what they made.

    python -I training/worker.py [--jobs ../chantgpt-jobs] [--data ../chantgpt-data] [--every 120]

Leave it running (Ctrl+C stops it; a job half done is run again next time). It keeps a clone of the `jobs` branch
beside this repository (made the first time), and uses the clone of `training-data` there too. Each job is a file
queue/<id>.json on that branch:

    {"id": "0007-finetune", "about": "what it is for",
     "data": ["real-labels.zip"],                      # zips on training-data, unpacked into this repository first
     "steps": [["recognizer.py", "train", "--resume", "training/data/model3/best.pt", "--epochs", "8", ...],
               ["recognizer.py", "export", "--model", "training/data/model6/best.pt", "--onnx", "OUT/chant.onnx"]],
     "keep": ["training/data/model6/best.pt"]}         # files copied back with the log

Only the training scripts are run (recognizer.py: train, test, export, clean, rebreak; cantus.py: lines, collect, tidy),
with arguments that stay inside this repository: nothing else. OUT in an argument is the job's results folder, DATA
the clone of training-data (to share pages to). The one path allowed outside: the folder cantus.py collect reads the
app's zips from (--downloads), which it only reads; and its --manifest, an https address it only matches.
Before each job the repository is brought up to date with main. The results go to results/<id>/ on the jobs
branch: log.txt (pushed every few minutes while it runs), the kept files, and done.json.
"""
import argparse, glob, json, os, platform, re, shutil, subprocess, sys, time, zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)
ALLOWED = {'recognizer.py': {'train', 'test', 'export', 'clean', 'rebreak'}, 'cantus.py': {'lines', 'collect', 'tidy'}}


def git(where, *args, check=True, quiet=False):
    r = subprocess.run(['git', '-C', where, *args], capture_output=True, text=True)
    if check and r.returncode:
        raise RuntimeError(f'git {" ".join(args)}: {r.stderr.strip() or r.stdout.strip()}')
    if not quiet and r.stdout.strip(): print(r.stdout.strip())
    return r


def say(*a): print(time.strftime('%H:%M:%S'), *a, flush=True)


def checked(step, out, data=None):
    """A step as the command to run, or an error: the script and subcommand allowed, every argument inside here."""
    if not isinstance(step, list) or len(step) < 2 or not all(isinstance(s, str) for s in step):
        raise ValueError(f'not a step: {step!r}')
    script, what = step[0], step[1]
    if what not in ALLOWED.get(script, ()):
        raise ValueError(f'not allowed: {script} {what}')
    args = []
    for k, s in enumerate(step[2:]):
        if script == 'cantus.py' and k and step[2:][k - 1] == '--downloads':
            if not os.path.isdir(s): raise ValueError(f'no folder {s}')
            args.append(s); continue
        if script == 'cantus.py' and k and step[2:][k - 1] == '--manifest':   # (a manifest's address, only matched)
            if not re.fullmatch(r'https://[\w.-]+/[\w./%:-]*', s): raise ValueError(f'not a manifest address: {s!r}')
            args.append(s); continue
        s = s.replace('OUT', out)
        if data and s == 'DATA': args.append(os.path.realpath(data)); continue
        if s.startswith('-'): args.append(s); continue
        if re.search(r'[\0\n]', s): raise ValueError(f'not allowed: {s!r}')
        if re.search(r'[\\/]', s) or s.startswith('.'):     # a path: it must stay inside the repository (or OUT)
            p = os.path.realpath(os.path.join(REPO, s))
            if not (p == REPO or p.startswith(REPO + os.sep) or p.startswith(os.path.realpath(out) + os.sep) or p == os.path.realpath(out)):
                raise ValueError(f'outside the repository: {s}')
        args.append(s)
    return [sys.executable, '-I', os.path.join(HERE, script), what, *args]


def unpack(data, names):
    """Zips from the training-data clone, unpacked into the repository (each once: a list of those done is kept). Each
    is fetched only for this, and taken out of the clone again once unpacked: the disk keeps what it holds, not both."""
    if not names: return
    git(data, 'pull', '--quiet')
    done_file = os.path.join(REPO, 'training', 'data', '.unpacked.json')
    done = json.load(open(done_file)) if os.path.exists(done_file) else {}
    for n in names:
        if not re.fullmatch(r'[\w.-]+\.zip', n): raise ValueError(f'not a zip on training-data: {n}')
        listed = git(data, 'ls-tree', '-l', 'HEAD', '--', n, quiet=True).stdout.split()
        if len(listed) < 4: raise ValueError(f'no {n} on training-data')
        stamp = listed[3]                                   # (its size)
        if done.get(n) == stamp: continue
        say(f'unpacking {n}')
        git(data, 'sparse-checkout', 'add', '/' + n)
        try:
            with zipfile.ZipFile(os.path.join(data, n)) as z:
                for m in z.namelist():
                    t = os.path.realpath(os.path.join(REPO, m))
                    if not t.startswith(REPO + os.sep): raise ValueError(f'{n}: {m} would land outside the repository')
                z.extractall(REPO)
        finally:
            git(data, 'sparse-checkout', 'set', '--no-cone', '/README.md')
        done[n] = stamp
        os.makedirs(os.path.dirname(done_file), exist_ok=True)
        json.dump(done, open(done_file, 'w'), indent=1)


def push(jobs, message):
    """The results so far, committed and pushed; a failure only said (a job never stops for it)."""
    try:
        git(jobs, 'add', '-A', 'results')
        # (what is staged, not what status shows: on Windows a file can look changed and stage as nothing)
        if not git(jobs, 'diff', '--cached', '--quiet', check=False, quiet=True).returncode: return
        git(jobs, 'commit', '--quiet', '-m', message)
    except RuntimeError as e:
        say(f'(could not commit the results: {e})'); return
    for k in range(4):
        if not git(jobs, 'push', '--quiet', check=False).returncode: return
        git(jobs, 'pull', '--rebase', '--quiet', check=False)
        time.sleep(5 * 2 ** k)
    say('(could not push: will try again with the next results)')


def run(job, jobs, data):
    jid = job['id']
    out = os.path.join(jobs, 'results', jid)
    os.makedirs(out, exist_ok=True)
    log_path = os.path.join(out, 'log.txt')
    started = time.strftime('%Y-%m-%d %H:%M:%S')
    status, failed_at = 'done', None
    with open(log_path, 'w', encoding='utf-8') as log:
        def note(s):
            log.write(s + '\n'); log.flush(); say(s)
        try:
            git(REPO, 'fetch', '--quiet', 'origin', 'main')
            git(REPO, 'checkout', '--quiet', 'main')
            git(REPO, 'merge', '--quiet', '--ff-only', 'origin/main')
            note(f'job {jid}: {job.get("about", "")}\ncode: {git(REPO, "rev-parse", "--short", "HEAD", quiet=True).stdout.strip()}')
            unpack(data, job.get('data', []))
            for k, step in enumerate(job.get('steps', [])):
                cmd = checked(step, out, data)
                note(f'\n$ {" ".join(step)}')
                p = subprocess.Popen(cmd, cwd=REPO, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, bufsize=1)
                last = time.time()
                for line in p.stdout:
                    log.write(line); log.flush(); print(line, end='', flush=True)
                    if time.time() - last > 300:                 # how it is going, every five minutes
                        push(jobs, f'{jid}: running'); last = time.time()
                if p.wait():
                    status, failed_at = 'failed', k; note(f'(step {k + 1} failed: exit {p.returncode})'); break
            for f in job.get('keep', []):
                src = os.path.realpath(os.path.join(REPO, f))
                if src.startswith(REPO + os.sep) and os.path.exists(src):
                    shutil.copy2(src, os.path.join(out, os.path.basename(f)))
                else: note(f'(nothing to keep at {f})')
        except Exception as e:
            status = 'failed'; note(f'(the job could not run: {e})')
    gpu = ''
    try:
        import torch_directml as d; gpu = d.device_name(0)
    except Exception:
        pass
    json.dump({'status': status, 'failed_step': failed_at, 'started': started, 'finished': time.strftime('%Y-%m-%d %H:%M:%S'),
               'machine': platform.node(), 'gpu': gpu}, open(os.path.join(out, 'done.json'), 'w'), indent=1)
    push(jobs, f'{jid}: {status}')
    say(f'job {jid}: {status}')


def lean(data, origin):
    """The clone of training-data, holding nothing but its history (a few MB): each zip is fetched when a job unpacks
    it, and the manuscripts' pages (cantus-*/) never (this computer trains only on the staves made from them). A clone
    made before this, with everything, is made again, to free the disk."""
    if os.path.isdir(os.path.join(data, '.git')):
        if git(data, 'config', 'remote.origin.partialclonefilter', check=False, quiet=True).stdout.strip(): return
        say(f'making {data} again without the manuscripts\' pages, to free the disk')
        shutil.rmtree(data, onerror=lambda f, p, e: (os.chmod(p, 0o700), f(p)))
    say(f'cloning the training-data branch into {data} (without the manuscripts\' pages)')
    subprocess.run(['git', 'clone', '--quiet', '--filter=blob:none', '--no-checkout', '--single-branch', '-b', 'training-data', origin, data], check=True)
    git(data, 'sparse-checkout', 'set', '--no-cone', '/README.md')
    git(data, 'checkout', '--quiet', 'training-data')


def main():
    a = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    a.add_argument('--jobs', default=os.path.join(os.path.dirname(REPO), 'chantgpt-jobs'))
    a.add_argument('--data', default=os.path.join(os.path.dirname(REPO), 'chantgpt-data'))
    a.add_argument('--every', type=int, default=120, help='seconds between looks for new jobs')
    a.add_argument('--once', action='store_true', help='run what is queued, then stop')
    o = a.parse_args()
    origin = git(REPO, 'remote', 'get-url', 'origin', quiet=True).stdout.strip()
    if not os.path.isdir(os.path.join(o.jobs, '.git')):
        say(f'cloning the jobs branch into {o.jobs}')
        subprocess.run(['git', 'clone', '--quiet', '--single-branch', '-b', 'jobs', origin, o.jobs], check=True)
    lean(o.data, origin)
    say(f'watching for jobs (every {o.every} s; Ctrl+C to stop)')
    while True:
        try:
            git(o.jobs, 'pull', '--rebase', '--quiet')
        except RuntimeError as e:
            say(f'(could not pull the jobs: {e})')
        for path in sorted(glob.glob(os.path.join(o.jobs, 'queue', '*.json'))):
            try:
                job = json.load(open(path, encoding='utf-8'))
            except ValueError:
                continue
            job['id'] = re.sub(r'[^\w.-]', '_', str(job.get('id') or os.path.basename(path)[:-5]))
            if os.path.exists(os.path.join(o.jobs, 'results', job['id'], 'done.json')): continue
            run(job, o.jobs, o.data)
            break                                                   # (then look again: the queue may have changed)
        else:
            if o.once: return
            time.sleep(o.every)


if __name__ == '__main__':
    try:
        main()
    except KeyboardInterrupt:
        say('stopped')
