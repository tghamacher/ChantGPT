"""Tests for gregobase.py's reading of a MySQL dump.   python -I training/test_gregobase.py"""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import gregobase as gb

SQL = r"""
INSERT INTO `gregobase_sources` (`id`, `year`, `period`, `editor`, `title`, `description`, `caption`, `pages`, `urls`) VALUES
(3, 1961, NULL, 'Solesmes', 'The Liber Usualis', 'It\'s the Liber', '', NULL, NULL);
INSERT INTO `gregobase_chants` (`id`, `cantusid`, `version`, `incipit`, `initial`, `office-part`, `mode`, `mode_var`, `transcriber`, `commentary`, `headers`, `gabc`, `gabc_verses`, `tex_verses`, `remarks`, `copyrighted`, `duplicateof`) VALUES
(1, NULL, 'Solesmes', 'Laudem Domini', 1, 'al', '1', NULL, 'A. H.', '', NULL, '[[\"tex\",\"x\",{}],[\"gabc\",\"(c4) AL(dc~)le(c)\\r\\nl\\u00fa(d)\",{}]]', NULL, NULL, NULL, 0, NULL),
(2, 'g00001', NULL, 'O quam', 1, 'an', '8', NULL, NULL, NULL, NULL, '\"(c4) O(g) quam(h) it\'s(g)\"', NULL, NULL, NULL, 1, 1);
INSERT INTO `gregobase_chant_sources` (`chant_id`, `source`, `page`, `sequence`, `extent`) VALUES
(1, 3, '888', 1, 2);
INSERT INTO `gregobase_tags` (`id`, `tag`) VALUES
(7, 'Pascha');
INSERT INTO `gregobase_chant_tags` (`chant_id`, `tag_id`) VALUES
(1, 7);
"""


def test():
    t = gb.tables(SQL)
    rows = {c['id']: c for c in gb.chants(t)}
    a, b = rows[1], rows[2]
    assert a['gabc'] == ['(c4) AL(dc~)le(c)\r\nlú(d)'], a['gabc']      # JSON elements: only the GABC ones
    assert a['sources'] == [{'source': 3, 'book': 'The Liber Usualis', 'year': 1961, 'editor': 'Solesmes', 'page': '888', 'sequence': 1, 'extent': 2}], a['sources']
    assert a['tags'] == ['Pascha'] and a['office_part'] == 'al' and a['mode'] == '1'
    assert b['gabc'] == ["(c4) O(g) quam(h) it's(g)"], b['gabc']        # a plain JSON string, quotes escaped
    assert b['copyrighted'] is True and b['duplicateof'] == 1 and b['cantusid'] == 'g00001'
    assert gb.sources(t)[3]['title'] == 'The Liber Usualis'
    assert gb.CODES['Responsorium breve'] == 'rb'
    print('PASS gregobase')


if __name__ == '__main__':
    test()
