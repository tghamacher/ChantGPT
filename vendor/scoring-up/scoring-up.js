// Scoring-up of mensural notation: JS_ScUp by Martha Thomae (MIT; LICENSE-JS_ScUp) and fraction.js by Robert Eisele
// (MIT; LICENSE-fraction.js), bundled unchanged by build.js. global.ScoringUp = { merge, ArsNova, ArsAntiqua, PostProcessing }.
(function (global) {
  'use strict';
  const quiet = { log() { }, info() { }, debug() { }, warn: (...a) => global.console && global.console.warn(...a), error: (...a) => global.console && global.console.error(...a) };
  const defs = {}, cache = {};
  const require = name => { if (!(name in cache)) { const module = { exports: {} }; cache[name] = module.exports; defs[name](module, module.exports, require); cache[name] = module.exports; } return cache[name]; };
  defs["fraction.js"] = function (module, exports, require) { const console = quiet;
/**
 * @license Fraction.js v4.3.7 31/08/2023
 * https://www.xarg.org/2014/03/rational-numbers-in-javascript/
 *
 * Copyright (c) 2023, Robert Eisele (robert@raw.org)
 * Dual licensed under the MIT or GPL Version 2 licenses.
 **/


/**
 *
 * This class offers the possibility to calculate fractions.
 * You can pass a fraction in different formats. Either as array, as double, as string or as an integer.
 *
 * Array/Object form
 * [ 0 => <numerator>, 1 => <denominator> ]
 * [ n => <numerator>, d => <denominator> ]
 *
 * Integer form
 * - Single integer value
 *
 * Double form
 * - Single double value
 *
 * String form
 * 123.456 - a simple double
 * 123/456 - a string fraction
 * 123.'456' - a double with repeating decimal places
 * 123.(456) - synonym
 * 123.45'6' - a double with repeating last place
 * 123.45(6) - synonym
 *
 * Example:
 *
 * var f = new Fraction("9.4'31'");
 * f.mul([-4, 3]).div(4.9);
 *
 */

(function(root) {

  "use strict";

  // Maximum search depth for cyclic rational numbers. 2000 should be more than enough.
  // Example: 1/7 = 0.(142857) has 6 repeating decimal places.
  // If MAX_CYCLE_LEN gets reduced, long cycles will not be detected and toString() only gets the first 10 digits
  var MAX_CYCLE_LEN = 2000;

  // Parsed data to avoid calling "new" all the time
  var P = {
    "s": 1,
    "n": 0,
    "d": 1
  };

  function assign(n, s) {

    if (isNaN(n = parseInt(n, 10))) {
      throw InvalidParameter();
    }
    return n * s;
  }

  // Creates a new Fraction internally without the need of the bulky constructor
  function newFraction(n, d) {

    if (d === 0) {
      throw DivisionByZero();
    }

    var f = Object.create(Fraction.prototype);
    f["s"] = n < 0 ? -1 : 1;

    n = n < 0 ? -n : n;

    var a = gcd(n, d);

    f["n"] = n / a;
    f["d"] = d / a;
    return f;
  }

  function factorize(num) {

    var factors = {};

    var n = num;
    var i = 2;
    var s = 4;

    while (s <= n) {

      while (n % i === 0) {
        n/= i;
        factors[i] = (factors[i] || 0) + 1;
      }
      s+= 1 + 2 * i++;
    }

    if (n !== num) {
      if (n > 1)
        factors[n] = (factors[n] || 0) + 1;
    } else {
      factors[num] = (factors[num] || 0) + 1;
    }
    return factors;
  }

  var parse = function(p1, p2) {

    var n = 0, d = 1, s = 1;
    var v = 0, w = 0, x = 0, y = 1, z = 1;

    var A = 0, B = 1;
    var C = 1, D = 1;

    var N = 10000000;
    var M;

    if (p1 === undefined || p1 === null) {
      /* void */
    } else if (p2 !== undefined) {
      n = p1;
      d = p2;
      s = n * d;

      if (n % 1 !== 0 || d % 1 !== 0) {
        throw NonIntegerParameter();
      }

    } else
      switch (typeof p1) {

        case "object":
          {
            if ("d" in p1 && "n" in p1) {
              n = p1["n"];
              d = p1["d"];
              if ("s" in p1)
                n*= p1["s"];
            } else if (0 in p1) {
              n = p1[0];
              if (1 in p1)
                d = p1[1];
            } else {
              throw InvalidParameter();
            }
            s = n * d;
            break;
          }
        case "number":
          {
            if (p1 < 0) {
              s = p1;
              p1 = -p1;
            }

            if (p1 % 1 === 0) {
              n = p1;
            } else if (p1 > 0) { // check for != 0, scale would become NaN (log(0)), which converges really slow

              if (p1 >= 1) {
                z = Math.pow(10, Math.floor(1 + Math.log(p1) / Math.LN10));
                p1/= z;
              }

              // Using Farey Sequences
              // http://www.johndcook.com/blog/2010/10/20/best-rational-approximation/

              while (B <= N && D <= N) {
                M = (A + C) / (B + D);

                if (p1 === M) {
                  if (B + D <= N) {
                    n = A + C;
                    d = B + D;
                  } else if (D > B) {
                    n = C;
                    d = D;
                  } else {
                    n = A;
                    d = B;
                  }
                  break;

                } else {

                  if (p1 > M) {
                    A+= C;
                    B+= D;
                  } else {
                    C+= A;
                    D+= B;
                  }

                  if (B > N) {
                    n = C;
                    d = D;
                  } else {
                    n = A;
                    d = B;
                  }
                }
              }
              n*= z;
            } else if (isNaN(p1) || isNaN(p2)) {
              d = n = NaN;
            }
            break;
          }
        case "string":
          {
            B = p1.match(/\d+|./g);

            if (B === null)
              throw InvalidParameter();

            if (B[A] === '-') {// Check for minus sign at the beginning
              s = -1;
              A++;
            } else if (B[A] === '+') {// Check for plus sign at the beginning
              A++;
            }

            if (B.length === A + 1) { // Check if it's just a simple number "1234"
              w = assign(B[A++], s);
            } else if (B[A + 1] === '.' || B[A] === '.') { // Check if it's a decimal number

              if (B[A] !== '.') { // Handle 0.5 and .5
                v = assign(B[A++], s);
              }
              A++;

              // Check for decimal places
              if (A + 1 === B.length || B[A + 1] === '(' && B[A + 3] === ')' || B[A + 1] === "'" && B[A + 3] === "'") {
                w = assign(B[A], s);
                y = Math.pow(10, B[A].length);
                A++;
              }

              // Check for repeating places
              if (B[A] === '(' && B[A + 2] === ')' || B[A] === "'" && B[A + 2] === "'") {
                x = assign(B[A + 1], s);
                z = Math.pow(10, B[A + 1].length) - 1;
                A+= 3;
              }

            } else if (B[A + 1] === '/' || B[A + 1] === ':') { // Check for a simple fraction "123/456" or "123:456"
              w = assign(B[A], s);
              y = assign(B[A + 2], 1);
              A+= 3;
            } else if (B[A + 3] === '/' && B[A + 1] === ' ') { // Check for a complex fraction "123 1/2"
              v = assign(B[A], s);
              w = assign(B[A + 2], s);
              y = assign(B[A + 4], 1);
              A+= 5;
            }

            if (B.length <= A) { // Check for more tokens on the stack
              d = y * z;
              s = /* void */
              n = x + d * v + z * w;
              break;
            }

            /* Fall through on error */
          }
        default:
          throw InvalidParameter();
      }

    if (d === 0) {
      throw DivisionByZero();
    }

    P["s"] = s < 0 ? -1 : 1;
    P["n"] = Math.abs(n);
    P["d"] = Math.abs(d);
  };

  function modpow(b, e, m) {

    var r = 1;
    for (; e > 0; b = (b * b) % m, e >>= 1) {

      if (e & 1) {
        r = (r * b) % m;
      }
    }
    return r;
  }


  function cycleLen(n, d) {

    for (; d % 2 === 0;
      d/= 2) {
    }

    for (; d % 5 === 0;
      d/= 5) {
    }

    if (d === 1) // Catch non-cyclic numbers
      return 0;

    // If we would like to compute really large numbers quicker, we could make use of Fermat's little theorem:
    // 10^(d-1) % d == 1
    // However, we don't need such large numbers and MAX_CYCLE_LEN should be the capstone,
    // as we want to translate the numbers to strings.

    var rem = 10 % d;
    var t = 1;

    for (; rem !== 1; t++) {
      rem = rem * 10 % d;

      if (t > MAX_CYCLE_LEN)
        return 0; // Returning 0 here means that we don't print it as a cyclic number. It's likely that the answer is `d-1`
    }
    return t;
  }


  function cycleStart(n, d, len) {

    var rem1 = 1;
    var rem2 = modpow(10, len, d);

    for (var t = 0; t < 300; t++) { // s < ~log10(Number.MAX_VALUE)
      // Solve 10^s == 10^(s+t) (mod d)

      if (rem1 === rem2)
        return t;

      rem1 = rem1 * 10 % d;
      rem2 = rem2 * 10 % d;
    }
    return 0;
  }

  function gcd(a, b) {

    if (!a)
      return b;
    if (!b)
      return a;

    while (1) {
      a%= b;
      if (!a)
        return b;
      b%= a;
      if (!b)
        return a;
    }
  };

  /**
   * Module constructor
   *
   * @constructor
   * @param {number|Fraction=} a
   * @param {number=} b
   */
  function Fraction(a, b) {

    parse(a, b);

    if (this instanceof Fraction) {
      a = gcd(P["d"], P["n"]); // Abuse variable a
      this["s"] = P["s"];
      this["n"] = P["n"] / a;
      this["d"] = P["d"] / a;
    } else {
      return newFraction(P['s'] * P['n'], P['d']);
    }
  }

  var DivisionByZero = function() { return new Error("Division by Zero"); };
  var InvalidParameter = function() { return new Error("Invalid argument"); };
  var NonIntegerParameter = function() { return new Error("Parameters must be integer"); };

  Fraction.prototype = {

    "s": 1,
    "n": 0,
    "d": 1,

    /**
     * Calculates the absolute value
     *
     * Ex: new Fraction(-4).abs() => 4
     **/
    "abs": function() {

      return newFraction(this["n"], this["d"]);
    },

    /**
     * Inverts the sign of the current fraction
     *
     * Ex: new Fraction(-4).neg() => 4
     **/
    "neg": function() {

      return newFraction(-this["s"] * this["n"], this["d"]);
    },

    /**
     * Adds two rational numbers
     *
     * Ex: new Fraction({n: 2, d: 3}).add("14.9") => 467 / 30
     **/
    "add": function(a, b) {

      parse(a, b);
      return newFraction(
        this["s"] * this["n"] * P["d"] + P["s"] * this["d"] * P["n"],
        this["d"] * P["d"]
      );
    },

    /**
     * Subtracts two rational numbers
     *
     * Ex: new Fraction({n: 2, d: 3}).add("14.9") => -427 / 30
     **/
    "sub": function(a, b) {

      parse(a, b);
      return newFraction(
        this["s"] * this["n"] * P["d"] - P["s"] * this["d"] * P["n"],
        this["d"] * P["d"]
      );
    },

    /**
     * Multiplies two rational numbers
     *
     * Ex: new Fraction("-17.(345)").mul(3) => 5776 / 111
     **/
    "mul": function(a, b) {

      parse(a, b);
      return newFraction(
        this["s"] * P["s"] * this["n"] * P["n"],
        this["d"] * P["d"]
      );
    },

    /**
     * Divides two rational numbers
     *
     * Ex: new Fraction("-17.(345)").inverse().div(3)
     **/
    "div": function(a, b) {

      parse(a, b);
      return newFraction(
        this["s"] * P["s"] * this["n"] * P["d"],
        this["d"] * P["n"]
      );
    },

    /**
     * Clones the actual object
     *
     * Ex: new Fraction("-17.(345)").clone()
     **/
    "clone": function() {
      return newFraction(this['s'] * this['n'], this['d']);
    },

    /**
     * Calculates the modulo of two rational numbers - a more precise fmod
     *
     * Ex: new Fraction('4.(3)').mod([7, 8]) => (13/3) % (7/8) = (5/6)
     **/
    "mod": function(a, b) {

      if (isNaN(this['n']) || isNaN(this['d'])) {
        return new Fraction(NaN);
      }

      if (a === undefined) {
        return newFraction(this["s"] * this["n"] % this["d"], 1);
      }

      parse(a, b);
      if (0 === P["n"] && 0 === this["d"]) {
        throw DivisionByZero();
      }

      /*
       * First silly attempt, kinda slow
       *
       return that["sub"]({
       "n": num["n"] * Math.floor((this.n / this.d) / (num.n / num.d)),
       "d": num["d"],
       "s": this["s"]
       });*/

      /*
       * New attempt: a1 / b1 = a2 / b2 * q + r
       * => b2 * a1 = a2 * b1 * q + b1 * b2 * r
       * => (b2 * a1 % a2 * b1) / (b1 * b2)
       */
      return newFraction(
        this["s"] * (P["d"] * this["n"]) % (P["n"] * this["d"]),
        P["d"] * this["d"]
      );
    },

    /**
     * Calculates the fractional gcd of two rational numbers
     *
     * Ex: new Fraction(5,8).gcd(3,7) => 1/56
     */
    "gcd": function(a, b) {

      parse(a, b);

      // gcd(a / b, c / d) = gcd(a, c) / lcm(b, d)

      return newFraction(gcd(P["n"], this["n"]) * gcd(P["d"], this["d"]), P["d"] * this["d"]);
    },

    /**
     * Calculates the fractional lcm of two rational numbers
     *
     * Ex: new Fraction(5,8).lcm(3,7) => 15
     */
    "lcm": function(a, b) {

      parse(a, b);

      // lcm(a / b, c / d) = lcm(a, c) / gcd(b, d)

      if (P["n"] === 0 && this["n"] === 0) {
        return newFraction(0, 1);
      }
      return newFraction(P["n"] * this["n"], gcd(P["n"], this["n"]) * gcd(P["d"], this["d"]));
    },

    /**
     * Calculates the ceil of a rational number
     *
     * Ex: new Fraction('4.(3)').ceil() => (5 / 1)
     **/
    "ceil": function(places) {

      places = Math.pow(10, places || 0);

      if (isNaN(this["n"]) || isNaN(this["d"])) {
        return new Fraction(NaN);
      }
      return newFraction(Math.ceil(places * this["s"] * this["n"] / this["d"]), places);
    },

    /**
     * Calculates the floor of a rational number
     *
     * Ex: new Fraction('4.(3)').floor() => (4 / 1)
     **/
    "floor": function(places) {

      places = Math.pow(10, places || 0);

      if (isNaN(this["n"]) || isNaN(this["d"])) {
        return new Fraction(NaN);
      }
      return newFraction(Math.floor(places * this["s"] * this["n"] / this["d"]), places);
    },

    /**
     * Rounds a rational numbers
     *
     * Ex: new Fraction('4.(3)').round() => (4 / 1)
     **/
    "round": function(places) {

      places = Math.pow(10, places || 0);

      if (isNaN(this["n"]) || isNaN(this["d"])) {
        return new Fraction(NaN);
      }
      return newFraction(Math.round(places * this["s"] * this["n"] / this["d"]), places);
    },

    /**
     * Rounds a rational number to a multiple of another rational number
     *
     * Ex: new Fraction('0.9').roundTo("1/8") => 7 / 8
     **/
    "roundTo": function(a, b) {

      /*
      k * x/y ≤ a/b < (k+1) * x/y
      ⇔ k ≤ a/b / (x/y) < (k+1)
      ⇔ k = floor(a/b * y/x)
      */

      parse(a, b);

      return newFraction(this['s'] * Math.round(this['n'] * P['d'] / (this['d'] * P['n'])) * P['n'], P['d']);
    },

    /**
     * Gets the inverse of the fraction, means numerator and denominator are exchanged
     *
     * Ex: new Fraction([-3, 4]).inverse() => -4 / 3
     **/
    "inverse": function() {

      return newFraction(this["s"] * this["d"], this["n"]);
    },

    /**
     * Calculates the fraction to some rational exponent, if possible
     *
     * Ex: new Fraction(-1,2).pow(-3) => -8
     */
    "pow": function(a, b) {

      parse(a, b);

      // Trivial case when exp is an integer

      if (P['d'] === 1) {

        if (P['s'] < 0) {
          return newFraction(Math.pow(this['s'] * this["d"], P['n']), Math.pow(this["n"], P['n']));
        } else {
          return newFraction(Math.pow(this['s'] * this["n"], P['n']), Math.pow(this["d"], P['n']));
        }
      }

      // Negative roots become complex
      //     (-a/b)^(c/d) = x
      // <=> (-1)^(c/d) * (a/b)^(c/d) = x
      // <=> (cos(pi) + i*sin(pi))^(c/d) * (a/b)^(c/d) = x         # rotate 1 by 180°
      // <=> (cos(c*pi/d) + i*sin(c*pi/d)) * (a/b)^(c/d) = x       # DeMoivre's formula in Q ( https://proofwiki.org/wiki/De_Moivre%27s_Formula/Rational_Index )
      // From which follows that only for c=0 the root is non-complex. c/d is a reduced fraction, so that sin(c/dpi)=0 occurs for d=1, which is handled by our trivial case.
      if (this['s'] < 0) return null;

      // Now prime factor n and d
      var N = factorize(this['n']);
      var D = factorize(this['d']);

      // Exponentiate and take root for n and d individually
      var n = 1;
      var d = 1;
      for (var k in N) {
        if (k === '1') continue;
        if (k === '0') {
          n = 0;
          break;
        }
        N[k]*= P['n'];

        if (N[k] % P['d'] === 0) {
          N[k]/= P['d'];
        } else return null;
        n*= Math.pow(k, N[k]);
      }

      for (var k in D) {
        if (k === '1') continue;
        D[k]*= P['n'];

        if (D[k] % P['d'] === 0) {
          D[k]/= P['d'];
        } else return null;
        d*= Math.pow(k, D[k]);
      }

      if (P['s'] < 0) {
        return newFraction(d, n);
      }
      return newFraction(n, d);
    },

    /**
     * Check if two rational numbers are the same
     *
     * Ex: new Fraction(19.6).equals([98, 5]);
     **/
    "equals": function(a, b) {

      parse(a, b);
      return this["s"] * this["n"] * P["d"] === P["s"] * P["n"] * this["d"]; // Same as compare() === 0
    },

    /**
     * Check if two rational numbers are the same
     *
     * Ex: new Fraction(19.6).equals([98, 5]);
     **/
    "compare": function(a, b) {

      parse(a, b);
      var t = (this["s"] * this["n"] * P["d"] - P["s"] * P["n"] * this["d"]);
      return (0 < t) - (t < 0);
    },

    "simplify": function(eps) {

      if (isNaN(this['n']) || isNaN(this['d'])) {
        return this;
      }

      eps = eps || 0.001;

      var thisABS = this['abs']();
      var cont = thisABS['toContinued']();

      for (var i = 1; i < cont.length; i++) {

        var s = newFraction(cont[i - 1], 1);
        for (var k = i - 2; k >= 0; k--) {
          s = s['inverse']()['add'](cont[k]);
        }

        if (Math.abs(s['sub'](thisABS).valueOf()) < eps) {
          return s['mul'](this['s']);
        }
      }
      return this;
    },

    /**
     * Check if two rational numbers are divisible
     *
     * Ex: new Fraction(19.6).divisible(1.5);
     */
    "divisible": function(a, b) {

      parse(a, b);
      return !(!(P["n"] * this["d"]) || ((this["n"] * P["d"]) % (P["n"] * this["d"])));
    },

    /**
     * Returns a decimal representation of the fraction
     *
     * Ex: new Fraction("100.'91823'").valueOf() => 100.91823918239183
     **/
    'valueOf': function() {

      return this["s"] * this["n"] / this["d"];
    },

    /**
     * Returns a string-fraction representation of a Fraction object
     *
     * Ex: new Fraction("1.'3'").toFraction(true) => "4 1/3"
     **/
    'toFraction': function(excludeWhole) {

      var whole, str = "";
      var n = this["n"];
      var d = this["d"];
      if (this["s"] < 0) {
        str+= '-';
      }

      if (d === 1) {
        str+= n;
      } else {

        if (excludeWhole && (whole = Math.floor(n / d)) > 0) {
          str+= whole;
          str+= " ";
          n%= d;
        }

        str+= n;
        str+= '/';
        str+= d;
      }
      return str;
    },

    /**
     * Returns a latex representation of a Fraction object
     *
     * Ex: new Fraction("1.'3'").toLatex() => "\frac{4}{3}"
     **/
    'toLatex': function(excludeWhole) {

      var whole, str = "";
      var n = this["n"];
      var d = this["d"];
      if (this["s"] < 0) {
        str+= '-';
      }

      if (d === 1) {
        str+= n;
      } else {

        if (excludeWhole && (whole = Math.floor(n / d)) > 0) {
          str+= whole;
          n%= d;
        }

        str+= "\\frac{";
        str+= n;
        str+= '}{';
        str+= d;
        str+= '}';
      }
      return str;
    },

    /**
     * Returns an array of continued fraction elements
     *
     * Ex: new Fraction("7/8").toContinued() => [0,1,7]
     */
    'toContinued': function() {

      var t;
      var a = this['n'];
      var b = this['d'];
      var res = [];

      if (isNaN(a) || isNaN(b)) {
        return res;
      }

      do {
        res.push(Math.floor(a / b));
        t = a % b;
        a = b;
        b = t;
      } while (a !== 1);

      return res;
    },

    /**
     * Creates a string representation of a fraction with all digits
     *
     * Ex: new Fraction("100.'91823'").toString() => "100.(91823)"
     **/
    'toString': function(dec) {

      var N = this["n"];
      var D = this["d"];

      if (isNaN(N) || isNaN(D)) {
        return "NaN";
      }

      dec = dec || 15; // 15 = decimal places when no repetation

      var cycLen = cycleLen(N, D); // Cycle length
      var cycOff = cycleStart(N, D, cycLen); // Cycle start

      var str = this['s'] < 0 ? "-" : "";

      str+= N / D | 0;

      N%= D;
      N*= 10;

      if (N)
        str+= ".";

      if (cycLen) {

        for (var i = cycOff; i--;) {
          str+= N / D | 0;
          N%= D;
          N*= 10;
        }
        str+= "(";
        for (var i = cycLen; i--;) {
          str+= N / D | 0;
          N%= D;
          N*= 10;
        }
        str+= ")";
      } else {
        for (var i = dec; N && i--;) {
          str+= N / D | 0;
          N%= D;
          N*= 10;
        }
      }
      return str;
    }
  };

  if (typeof exports === "object") {
    Object.defineProperty(exports, "__esModule", { 'value': true });
    exports['default'] = Fraction;
    module['exports'] = Fraction;
  } else {
    root['Fraction'] = Fraction;
  }

})(this);

  };
  defs["./Merge.js"] = function (module, exports, require) { const console = quiet;
/*
    MERGE MODULE:
    Change the file structure from parts-based to score-based.
    Returns a quasi-score (staves piled-up without voice alignment).
*/

function cleanup(meiDoc) {
    // Remove <pb> and <sb> elements
    const pb_elements = Array.from(meiDoc.getElementsByTagName('pb'));
    const sb_elements = Array.from(meiDoc.getElementsByTagName('sb'));
    var parent;
    for (var pageBegin of pb_elements) {
        parent = pageBegin.parentElement;
        parent.removeChild(pageBegin);
    }
    for (var systemBegin of sb_elements) {
        parent = systemBegin.parentElement;
        parent.removeChild(systemBegin);
    }
}

function clef_definition(staff, staffDef) {
    // Retrieving all <clef> elements of the given voice, and finding the initial clef
    const clefs = Array.from(staff.getElementsByTagName('clef'));
    const initialClef = clefs[0];
    // Encode the first clef of the voice (initialClef) within <staffDef>
    for (var attribute_name of initialClef.getAttributeNames()){
        if (attribute_name != 'xml:id') {
            var attribute_value = initialClef.getAttribute(attribute_name);
            staffDef.setAttribute('clef.'+attribute_name, attribute_value);
        }
    } // Remove the corresponding <clef> element
    var parent = initialClef.parentElement;
    parent.removeChild(initialClef);
    // Remove all remaining <clef> elements of the voice
    // except the ones encoding a change in clef.
    for (var i = 1; i < clefs.length; i ++) {
        var clef = clefs[i];
        var prev_clef = clefs[i-1];
        // If the i-th <clef> element encodes the same clef as
        // the previous <clef> element (i-1), remove it.
        if (clef.getAttribute('line') == prev_clef.getAttribute('line') && clef.getAttribute('shape') == prev_clef.getAttribute('shape')) {
            parent = clef.parentElement;
            parent.removeChild(clef);
        }
    }
}

/*
    REPEATING TENOR FUNCTIONS:
    The "main" function is the "expand_repeating_tenor" which calls both the
    "get_set_of_repeated_notes" to retrieve all the elements that should be
    repeated (e.g., notes, rests, ligatures) and then it adds each of them
    with the "add_cloned_elements" function.
*/
function get_set_of_repeated_notes(meiDoc, startid, endid){
    // Define repeated_elements array and add its starting element (based on the startid)
    var resolver = meiDoc.createNSResolver(meiDoc.ownerDocument == null ? meiDoc.documentElement : meiDoc.ownerDocument.documentElement);
    var startRptElement = meiDoc.evaluate("//*[@xml:id='" + startid + "']", meiDoc, resolver, window.XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
    var repeated_elements = Array.from([startRptElement]);
    var nextRptElement = startRptElement.nextSibling;
    // Add all the following elements
    while (nextRptElement.getAttribute('xml:id') != endid) {
        if (nextRptElement.tagName != 'clef') {
            repeated_elements.push(nextRptElement);
        } nextRptElement = nextRptElement.nextSibling;
    }// Add last repeated element (corresponding to the endid)
    repeated_elements.push(nextRptElement);
    return repeated_elements;
}

function add_cloned_elements(tenor_layer, repeating_tenor, times){
    // Expand the repeated tenor into individual notes by cloning its elements
    // and adding them (with a @copyof attribute) in the right place
    var followElem, flagRepeatAtEnd, i, element, copied_element, xmlId, copied_descendant;
    var lastRptNote = repeating_tenor[repeating_tenor.length-1];

    // Determine the place to add the copied notes
    // (at the end of the layer or not)
    try {
        followElem = lastRptNote.nextSibling;
        flagRepeatAtEnd = false;
    } catch(err) {
        flagRepeatAtEnd = true;
    }

    // Based on the location, either: 
    if (flagRepeatAtEnd){
        // Add the notes at the end of the tenor_layer (appendChild)
        for (i = 0; i < times; i++) {
            for (element of repeating_tenor){
                // Create a clone of the element (this will keep attributes and descendants)
                copied_element = element.cloneNode(true);
                // Add the @copyof attribute and change its XML ID based on the original ID
                xmlId = element.getAttribute('xml:id');
                copied_element.setAttribute('copyof', '#'+xmlId);
                copied_element.setAttribute('xml:id', xmlId+'_'+(i+1));
                // Add the cloned element
                //(this will add it with the same attributes and descendants as the original)
                tenor_layer.appendChild(copied_element);
                // And change the XML ID of the descendants of these clones
                //(so that they don't have the same as the origianl descenadants)
                // and add the appropriate @copyof value.
                for (copied_descendant of copied_element.querySelectorAll('*')){
                    xmlId = copied_descendant.getAttribute('xml:id');
                    copied_descendant.setAttribute('copyof', '#'+xmlId);
                    copied_descendant.setAttribute('xml:id', xmlId+'_'+(i+1));
                }
            }
        }
    } else {
        // Add the notes before the element following the last
        // element of the repeated tenor (insertBefore method)
        for (i = 0; i < times; i++) {
            for (element of repeating_tenor){
                // Create a clone of the element (this will keep attributes and descendants)
                copied_element = element.cloneNode(true);
                // Add the @copyof attribute and change its XML ID based on the original ID
                xmlId = element.getAttribute('xml:id');
                copied_element.setAttribute('copyof', '#'+xmlId);
                copied_element.setAttribute('xml:id', xmlId+'_'+(i+1));
                // Add the cloned element
                //(this will add it with the same attributes and descendants as the original)
                tenor_layer.insertBefore(copied_element, followElem);
                // And change the XML ID of the descendants of these clones
                //(so that they don't have the same as the origianl descenadants)
                // and add the appropriate @copyof value.
                for (copied_descendant of copied_element.querySelectorAll('*')){
                    xmlId = copied_descendant.getAttribute('xml:id');
                    copied_descendant.setAttribute('copyof', '#'+xmlId);
                    copied_descendant.setAttribute('xml:id', xmlId+'_'+(i+1));
                }
            }
        }
    }
}

function expand_repeating_tenor(meiDoc){
    // Find the <dir> element and use it to locate the tenor's <staff> and <layer> elements
    const dir = meiDoc.getElementsByTagName('dir')[0];
    const tenor_staff = dir.parentElement;
    const tenor_layer = tenor_staff.getElementsByTagName('layer')[0];

    // Retrieve <dir> attributes related to the repetition:
    // - IDs pointing to the beginning and end of the set of notes to be repeated (@plist)
    var plist_array = dir.getAttribute('plist').split(' ');
    var startid_ref = plist_array[0];
    var endid_ref = plist_array[1];
    // - And the number of times this sequence of is to be repeated (encoded at @n for now)
    var times = dir.getAttribute('n');

    // Retrieve the notes repeated in the tenor
    var repeating_tenor = get_set_of_repeated_notes(meiDoc, startid_ref.slice(1,), endid_ref.slice(1,));

    // Expand the repeated tenor into individual notes with @copyof attribute.
    // This is done by adding the copied elements in the appropriate place of the
    // tenor_layer a given number of times
    add_cloned_elements(tenor_layer, repeating_tenor, times);

    // Finally, remove the <dir> element encoding the repetition
    tenor_staff.removeChild(dir);
}

const merge = meiDoc => {
    const mei = meiDoc.documentElement;

    // Get <mdiv> element and add to it the newly created <score> element
    const mdiv = mei.getElementsByTagName('mdiv')[0];
    const score = meiDoc.createElementNS('http://www.music-encoding.org/ns/mei', 'score');
    mdiv.appendChild(score);

    // Add everything related to the metadata of the score (<scoreDef> and descendants)
    // Add (new) <scoreDef> (include @midi.bpm = 600 for playback)
    const scoreDef = meiDoc.createElementNS('http://www.music-encoding.org/ns/mei', 'scoreDef');
    scoreDef.setAttribute('midi.bpm', '600');
    score.appendChild(scoreDef);
    // Add (new) <staffGrp> (include @symbol = bracket)
    const staffGrp = meiDoc.createElementNS('http://www.music-encoding.org/ns/mei', 'staffGrp');
    staffGrp.setAttribute('symbol', 'bracket');
    scoreDef.appendChild(staffGrp);
    // Add the pre-existing <staffDef> elements for each voice
    const stavesDef_list = mei.getElementsByTagName("staffDef");
    const stavesDef = Array.from(stavesDef_list);
    for (var staffDef of stavesDef){
        staffGrp.appendChild(staffDef);
        // Add <label> as a child of <staffDef> to include the voice type as text
        var label = meiDoc.createElementNS('http://www.music-encoding.org/ns/mei', 'label');
        label.textContent = staffDef.getAttribute('label');
        staffDef.insertBefore(label, staffDef.children[0]);
        // And remove the corresponding @label attribute from <staffDef>
        // (the value of @label does not get rendered in Verovio)
        staffDef.removeAttribute('label');

    }
    // Add everything related to the music content
    // Add <section>
    const section = meiDoc.createElementNS('http://www.music-encoding.org/ns/mei', 'section');
    score.appendChild(section);
    // Add the pre-existing <staff> elements encoding each voice
    const staves_list = mei.getElementsByTagName("staff");
    const staves = Array.from(staves_list);
    for (var staff of staves){
        section.appendChild(staff);
    }

    // Clean Up:
    // Remove <parts>
    mdiv.removeChild(mei.getElementsByTagName('parts')[0]);
    // Remove extraneous elements: <pb> and <sb>
    cleanup(meiDoc);
    // Move attributes or modify their values (given the new <score>-based structure):
    // @n and clef-related attributes
    for (var i = 0; i < staves.length; i++){
        staff = staves[i];
        staffDef = stavesDef[i];
        // Change value of @n in each <staff> and <staffDef> elements
        staff.setAttribute('n', i+1+'');
        staffDef.setAttribute('n', i+1+'');
        // Remove unnecesary <clef> elements in the voice (i.e., <staff>) and
        // Encode inital clef within the voice's metadata (i.e., <staffDef> attributes)
        clef_definition(staff, staffDef);
    }
    // Expand repeating tenor if there is one
    // (this is, if there is a <dir> element encoding the repeating tenor)
    if (meiDoc.getElementsByTagName('dir').length != 0){
        expand_repeating_tenor(meiDoc);
    }

    return meiDoc;
};

exports.merge = merge;

  };
  defs["./ArsNova_and_WhiteMensural.js"] = function (module, exports, require) { const console = quiet;
/*
    DURATION FINDER MODULE FOR ARS ANTIQUA
    Figure out the duration of the notes in the individual <staff> elements.
*/
const Fraction = require('fraction.js');

// Functions about preceding and suceeding elements
function get_next_element(target_element) {
    return target_element.nextElementSibling;
}

function get_preceding_noterest(target_element) {
    var preceding_element = target_element.previousElementSibling;
    while (preceding_element.tagName != 'note' && preceding_element.tagName != 'rest'){
        preceding_element = preceding_element.previousElementSibling;
    } return preceding_element;
}

// Functions related to dots
function followed_by_dot(target_element) {
    var next_element = get_next_element(target_element);
    if (next_element != null && next_element.tagName == 'dot') {
        return true;
    } else {
        return false;
    }
}

function find_first_dotted_note(sequence_of_notes) {
    //Return the index of the first dotted note in a sequence of notes
    var note_counter = -1;
    var first_dotted_note_index = -1;
    for (var noterest of sequence_of_notes) {
        note_counter += 1;
        if (noterest != null && followed_by_dot(noterest)) {
            first_dotted_note_index = note_counter;
            break;
        }
    }
    return first_dotted_note_index;
}

// Functions related to the counting of minims in a sequence of notes
function counting_minims_in_an_undotted_sequence(sequence_of_notes, note_durs, undotted_note_gain) {
    var minim_counter, note, dur, index, gain, ratio;
    minim_counter = 0;
    console.log('@dur\t\tCounter (m)\tAccumulator (m)');
    for (note of sequence_of_notes) {
        dur = note.getAttribute('dur');
        try {
            index = note_durs.indexOf(dur);
        } catch(err) {
            console.log("MISTAKE\nNote/Rest element not considered: " + note + ", with a duration @dur = " + dur);
        }
        gain = undotted_note_gain[index];
        if (note.hasAttribute('num') && note.hasAttribute('numbase')) {
            ratio = new Fraction([note.getAttribute('numbase'), note.getAttribute('num')]);
            gain = ratio.mul(gain);
        }
        minim_counter += gain;
        console.log(dur + Array(10-dur.length).join(' ') + "\t" + gain + "\t\t" + minim_counter);
    }
    return minim_counter;
}

function counting_minims(sequence_of_notes, note_durs, undotted_note_gain, dotted_note_gain, prolatio = null, tempus = null, modusminor = null, modusmaior = null) {
    var minim_counter, note, dur, index, gain, ratio, dot_element;
    minim_counter = 0;
    console.log('@dur\t\tCounter (m)\tAccumulator (m)');
    for (note of sequence_of_notes) {
        dur = note.getAttribute('dur');
        try {
            index = note_durs.indexOf(dur);
        } catch(err) {
            console.log("MISTAKE\nNote/Rest element not considered: " + note + ", with a duration @dur = " + dur);
        }
        // Defining the gain in case of dotted or undotted notes:
        if (followed_by_dot(note)) {
            gain = dotted_note_gain[index];
            // This dot could be either of perfection or of augmentation.
            // In the case of a dot of perfection there is no need to do anything, as the note value is kept perfect.
            // In the case of a dot of augmentation, the note value should be changed from imperfect to perfect.
            if ((index == 4 && prolatio == 2) || (index == 5 && tempus == 2) || (index == 6 && modusminor == 2) || (index == 7 && modusmaior == 2) || (index < 4)) {
            //// NOTE TO SELF: ////
            //////// Right now index == 1, is the index of prolatio. ////////
            //////// If later I put prolatio in a higher index like n, ////////
            //////// the information in this if should change accordingly. ////////
                // Case: Dot of Augmentation
                // Encode the augmentation dot
                dot_element = get_next_element(note);
                dot_element.setAttribute('form', 'aug');
                // Perform the augmentation, multiply the note value by 1.5
                note.setAttribute('num', '2');
                note.setAttribute('numbase', '3');
                // Thus the default "imperfect" note, becomes a perfect note
                note.setAttribute('dur.quality', 'perfecta');
            }
        } else {
            gain = undotted_note_gain[index];
            if (note.hasAttribute('num') && note.hasAttribute('numbase')) {
                ratio = new Fraction([note.getAttribute('numbase'), note.getAttribute('num')]);
                gain = ratio.mul(gain);
            }
        }
        minim_counter += gain;
        console.log(dur + Array(10-dur.length).join(' ') + "\t" + gain + "\t\t" + minim_counter);
    }
    return minim_counter;
}

function has_been_modified(note) {
    return (note.hasAttribute('num') && note.hasAttribute('numbase'));
}

// Given the total amount of "breves" in-between the "longs", see if they can be arranged in groups of 3
// According to how many breves remain ungrouped (1, 2 or 0), modifiy the duration of the appropriate note of the sequence ('imperfection', 'alteration', no-modification)
function modification(counter, start_note, middle_notes, end_note, following_note, short_note, long_note) {
    var last_middle_note, last_uncolored_note;

    switch(counter % 3) {

        case 1: // 1 breve left out:

            if (start_note != null && start_note.tagName == 'note' && start_note.getAttribute('dur') == long_note && !(has_been_modified(start_note)) && !(followed_by_dot(start_note))) {
            // Default Case
                // Imperfection a.p.p.
                console.log("Default Case:\tImperfection a.p.p.\n");
                start_note.setAttribute('dur.quality', 'imperfecta');
                start_note.setAttribute('num', '3');
                start_note.setAttribute('numbase', '2');
            }

            else if (end_note != null && end_note.tagName == 'note' && end_note.getAttribute('dur') == long_note && !(has_been_modified(end_note)) && !(followed_by_dot(end_note))) {
            // Exception Case
                // Imperfection a.p.a.
                console.log("Alternative Case:  Imperfection a.p.a.\n");
                end_note.setAttribute('dur.quality', 'imperfecta');
                end_note.setAttribute('num', '3');
                end_note.setAttribute('numbase', '2');
                // Raise a warning when this imperfect note is followed by a perfect note (contradiction with the first rule)
                if (following_note != null && following_note.getAttribute('dur') == long_note) {
                    console.log("WARNING 1! An imperfection a.p.a. is required, but this imperfect note is followed by a perfect note, this contradicts the fundamental rule: 'A note is perfect before another one of the same kind'.");
                    console.log("The imperfected note is " + end_note + " and is followed by the perfect note " + following_note + "\n");
                }
            }

            else {
            // Mistake Case
                console.log("MISTAKE 1 - Impossible to do Imperfection a.p.p. and also Imperfection a.p.a.");
                console.log(start_note);
                console.log(end_note);
                console.log("\n");
            } break;

        case 2: // 2 breves left out:
            // One of he possibilities when 2 breves are left out, is alteration
            // One must alter the last (uncolored) note from the middle_notes of the sequence
            last_middle_note = middle_notes[middle_notes.length - 1];
            // If the last note is uncolored, it is a candidate for alteration (given that it is a note and not a rest, and that it is a breve and not a smaller value)
            last_uncolored_note = last_middle_note;
            // But if it is colored, we need to find the last "uncolored" note, as this is the one that would be altered
            while (last_uncolored_note.hasAttribute('colored')){
                last_uncolored_note = get_preceding_noterest(last_uncolored_note);
            }

            if (counter == 2) { // 2 exact breves between the longs

                if (last_uncolored_note.tagName == 'note' && last_uncolored_note.getAttribute('dur') == short_note && !(has_been_modified(last_uncolored_note))) {
                // Default case
                    // Alteration
                    console.log("Default Case:\tAlteration\n");
                    last_uncolored_note.setAttribute('dur.quality', 'altera');
                    last_uncolored_note.setAttribute('num', '1');
                    last_uncolored_note.setAttribute('numbase', '2');
                }

                else if ((start_note != null && start_note.tagName == 'note' && start_note.getAttribute('dur') == long_note && !(has_been_modified(start_note)) && !(followed_by_dot(start_note))) && (end_note != null && end_note.tagName == 'note' && end_note.getAttribute('dur') == long_note && !(has_been_modified(end_note)) && !(followed_by_dot(end_note)))) {
                // Exception Case
                    console.log("Alternative Case:  Imperfection a.p.p. & Imperfection a.p.a.\n");
                    // Imperfection a.p.p.
                    start_note.setAttribute('dur.quality', 'imperfecta');
                    start_note.setAttribute('num', '3');
                    start_note.setAttribute('numbase', '2');
                    // Imperfection a.p.a.
                    end_note.setAttribute('dur.quality', 'imperfecta');
                    end_note.setAttribute('num', '3');
                    end_note.setAttribute('numbase', '2');
                    // Raise a warning when this imperfect note is followed by a perfect note (contradiction with the first rule)
                    if (following_note != null && following_note.getAttribute('dur') == long_note) {
                        console.log("WARNING 2! An imperfection a.p.a. is required, but this imperfect note is followed by a perfect note, this contradicts the fundamental rule: 'A note is perfect before another one of the same kind'.");
                        console.log("The imperfected note is " + end_note + " and is followed by the perfect note " + following_note);
                        console.log("\n");
                    }
                }

                else {
                // Mistake Case
                    console.log("MISTAKE 2 - Alteration is impossible - Imperfections a.p.p. and a.p.a. are also impossible");
                    console.log(start_note);
                    console.log(end_note);
                    console.log("\n");
                }

            } else { // 5, 8, 11, 14, 17, 20, ... breves between the longs
                console.log(last_uncolored_note);
                // Default Case: Check the conditions to apply the 'default interpretation', which implies imperfection a.p.a.

                if ((start_note != null && start_note.tagName == 'note' && start_note.getAttribute('dur') == long_note && !(has_been_modified(start_note)) && !(followed_by_dot(start_note))) && (end_note != null && end_note.tagName == 'note' && end_note.getAttribute('dur') == long_note && !(has_been_modified(end_note)) && !(followed_by_dot(end_note)))) {
                    // Check if imperfection a.p.a. enters or not in conflict with rule # 1.
                    if (following_note != null && following_note.getAttribute('dur') == long_note) {
                        // If it does, imperfection a.p.a. is discarded, except if the "alterantive interpretation" (the 'Exception Case') is also forbidden
                        if (last_uncolored_note.tagName == 'note' && last_uncolored_note.getAttribute('dur') == short_note && !(has_been_modified(last_uncolored_note))) {
                        // Exception Case
                            // Alteration
                            console.log("Alternative Case:  Alteration\n");
                            last_uncolored_note.setAttribute('dur.quality', 'altera');
                            last_uncolored_note.setAttribute('num', '1');
                            last_uncolored_note.setAttribute('numbase', '2');
                        }
                        else {
                        // Default + Warning Case
                            console.log("Default Case:\tImperfection a.p.p. & Imperfection a.p.a.\n");
                            // If the "alternative interpretation" is forbidden, and imperfection a.p.a. was discarded just because it entered in conflict with rule # 1
                            // (this is, impapa_against_rule1 flag is True), then we force imperfection a.p.a. as it is the only viable option. But we also raise a 'warning'
                            // Imperfection a.p.p.
                            start_note.setAttribute('dur.quality', 'imperfecta');
                            start_note.setAttribute('num', '3');
                            start_note.setAttribute('numbase', '2');
                            // Imperfection a.p.a.
                            end_note.setAttribute('dur.quality', 'imperfecta');
                            end_note.setAttribute('num', '3');
                            end_note.setAttribute('numbase', '2');
                            // Raise a warning when this imperfect note is followed by a perfect note (contradiction with the first rule)
                            console.log("WARNING 3n + 2! An imperfection a.p.a. is required, but this imperfect note is followed by a perfect note, this contradicts the fundamental rule: 'A note is perfect before another one of the same kind'.");
                            console.log("The imperfected note is " + end_note + " and is followed by the perfect note " + following_note);
                            console.log("\n");
                        }
                    // If it does not enter in conflict, we go with the "Default interpretation" of the notes
                    } else {
                    // Default Case
                        console.log("Default Case:\tImperfection a.p.p. & Imperfection a.p.a.\n");
                        // Imperfection a.p.p.
                        start_note.setAttribute('dur.quality', 'imperfecta');
                        start_note.setAttribute('num', '3');
                        start_note.setAttribute('numbase', '2');
                        // Imperfection a.p.a.
                        end_note.setAttribute('dur.quality', 'imperfecta');
                        end_note.setAttribute('num', '3');
                        end_note.setAttribute('numbase', '2');
                    }
                }

                else if (last_uncolored_note.tagName == 'note' && last_uncolored_note.getAttribute('dur') == short_note && !(has_been_modified(last_uncolored_note))) {
                // Exception Case
                    // Alteration
                    console.log("Alternative Case:  Alteration\n");
                    last_uncolored_note.setAttribute('dur.quality', 'altera');
                    last_uncolored_note.setAttribute('num', '1');
                    last_uncolored_note.setAttribute('numbase', '2');
                }

                else {// Mistake Case
                    console.log("MISTAKE 3n + 2 - Imperfections a.p.p. and a.p.a. are impossible - Alteration is also impossible");
                    console.log(start_note);
                    console.log(end_note);
                    console.log("\n");
                }
            } break;

        case 0: // 0 breves left out:

            if (counter <= 3) {
                // When 0 or 3 breves left out, no modifications to perform
                console.log("Default Case:\tNo modifications\n");
            }

            else {
                // One of the possibilities when 6,9,12,etc. breves are left out, involves alteration
                // One must alter the last (uncolored) note from the middle_notes of the sequence
                last_middle_note = middle_notes[middle_notes.length - 1];
                // If the last note is uncolored, it is a candidate for alteration (given that it is a note and not a rest, and that it is a breve and not a smaller value)
                last_uncolored_note = last_middle_note;
                // But if it is colored, we need to find the last "uncolored" note, as this is the one that would be altered
                while (last_uncolored_note.hasAttribute('colored')) {
                    last_uncolored_note = get_preceding_noterest(last_uncolored_note);
                }

                if ((start_note != null && start_note.tagName == 'note' && start_note.getAttribute('dur') == long_note && !(has_been_modified(start_note)) && !(followed_by_dot(start_note))) && (last_uncolored_note.tagName == 'note' && last_uncolored_note.getAttribute('dur') == short_note && !(has_been_modified(last_uncolored_note)))) {
                // Default Case:
                    console.log("Default Case:\tImperfection a.p.p. & Alteration\n");
                    // Imperfection a.p.p.
                    start_note.setAttribute('dur.quality', 'imperfecta');
                    start_note.setAttribute('num', '3');
                    start_note.setAttribute('numbase', '2');
                    // Alteration
                    last_uncolored_note.setAttribute('dur.quality', 'altera');
                    last_uncolored_note.setAttribute('num', '1');
                    last_uncolored_note.setAttribute('numbase', '2');
                }

                else {// Exception Case:
                    console.log("Alternative Case:  No modifications\n");
                    // Start note remains perfect
                }
            } break;
    }
}

// 'Processing functions'
// Determining the number of minims, semibreves, or breves between the boundaries (start_note and end_note) of a sequence of notes.
//(This number is used by the 'modification' function to apply the right modifications to the sequence.)
function minims_between_semibreves_processing(start_note, middle_notes, end_note, following_note, note_durs, undotted_note_gain, dotted_note_gain) {
    var no_division_dot_flag = true;    // Default value
    var sequence = [start_note].concat(middle_notes);
    var first_dotted_note_index = find_first_dotted_note(sequence);
    console.log('1st dotted note index:', first_dotted_note_index);
    var minim_counter, dot_element, first_dotted_note, part1_middle_notes, part2_middle_notes, minim_counter1, minim_counter2, dur, first_dotted_note_default_gain;

    // If first_dotted_note_index == -1, then there is no dot in the sequence at all
    if (first_dotted_note_index == -1) {
        // Getting the total of minims in the middle_notes
        minim_counter = counting_minims_in_an_undotted_sequence(middle_notes, note_durs, undotted_note_gain);
        // console.log('No-dot\n');
    }

    // If first_dotted_note_index == 0, we have a dot at the start_note, which will make this note 'perfect' --> DOT OF PERFECTION. The other dots must be of augmentation (or perfection dots).
    else if (first_dotted_note_index == 0) {
        // DOT OF PERFECTION
        dot_element = get_next_element(start_note);
        dot_element.setAttribute('form', 'perf');
        // console.log('Perfection\n');
        // Getting the total of minims in the middle_notes
        minim_counter = counting_minims(middle_notes, note_durs, undotted_note_gain, dotted_note_gain);
    }

    //Otherwise, if the dot is in any middle note:
    else {
        first_dotted_note = sequence[first_dotted_note_index];////////////////////////////////////////
        dot_element = get_next_element(first_dotted_note);
        if (dot_element.hasAttribute('form') && dot_element.getAttribute('form') == 'aug') {
            // If the first dot is an already known dot of augmentation
            minim_counter = counting_minims(middle_notes, note_durs, undotted_note_gain, dotted_note_gain);
        } else {
            // We have to divide the sequence of middle_notes in 2 parts: before the dot, and after the dot.
            // Then count the number of minims in each of the two parts to discover if this 'dot' is a
            // 'dot of division' or a 'dot of addition'
            part1_middle_notes = sequence.slice(1, first_dotted_note_index + 1);
            part2_middle_notes = sequence.slice(first_dotted_note_index + 1, sequence.length);

            // Minims BEFORE the first dot
            minim_counter1 = counting_minims_in_an_undotted_sequence(part1_middle_notes, note_durs, undotted_note_gain);

            // The individual value of the first dotted note (the last note in the sequence preceding the dot)
            dur = first_dotted_note.getAttribute('dur');
            first_dotted_note_default_gain = undotted_note_gain[note_durs.indexOf(dur)];
            // console.log("Notes in the Sequence preceding this dot " + part1_middle_notes);
            // console.log("FIRST DOTTED NOTE: " + first_dotted_note + ", with duration of: " + dur + ", which gain is: " + first_dotted_note_default_gain);

            // Taking the second part of the sequence of the middle notes (part2_middle_notes) into account
            // Count the number of minims in the second part of the sequence of middle_notes
            minim_counter2 = counting_minims(part2_middle_notes, note_durs, undotted_note_gain, dotted_note_gain);


            // If there is just one minim before the first dot
            if( minim_counter1 == 1) {
                // Two possibilities: dot of division / dot of augmentation
                // We have to use the results of the second part of the middle notes (part2_middle_notes) to figure this out

                // If the number of minims after the dot is an integer number
                if (minim_counter2 == Math.floor(minim_counter2)) {
                    // DOT OF DIVISION
                    no_division_dot_flag = false;
                    // console.log('Imperfection app\n');
                    dot_element.setAttribute('form', 'div');
                    minim_counter = minim_counter1 + minim_counter2;
                    // Total of minims in the middle_notes
                    modification(minim_counter1, start_note, part1_middle_notes, null, null, 'minima', 'semibrevis');
                    modification(minim_counter2, null, part2_middle_notes, end_note, following_note, 'minima', 'semibrevis');
                }
                else {
                    // DOT OF AUGMENTATION
                    // console.log('Augmentation_typeI\n');
                    dot_element.setAttribute('form', 'aug');
                    first_dotted_note.setAttribute('dur.quality', 'perfecta');
                    first_dotted_note.setAttribute('num', '2');
                    first_dotted_note.setAttribute('numbase', '3');
                    minim_counter = minim_counter1 + (0.5 * first_dotted_note_default_gain) + minim_counter2;
                }
            }

            // If there is more than one minim before the first dot, it is impossible for that dot to be a 'dot of division'
            else {
                // DOT OF AUGMENTATION (or a dot of perfection at smaller note level)
                if (dot_element.hasAttribute('form') && dot_element.getAttribute('form') == 'perf') {
                    minim_counter = counting_minims(middle_notes, note_durs, undotted_note_gain, dotted_note_gain);
                } else {
                    // console.log('Augmentation_def\n');
                    dot_element.setAttribute('form', 'aug');
                    first_dotted_note.setAttribute('dur.quality', 'perfecta');
                    first_dotted_note.setAttribute('num', '2');
                    first_dotted_note.setAttribute('numbase', '3');
                    minim_counter = minim_counter1 + (0.5 * first_dotted_note_default_gain) + minim_counter2;
                }
            }
        }
    }

    if (no_division_dot_flag) {
        // Checking that the sequence of notes is fine, and then calling the modification function
        if(minim_counter == Math.floor(minim_counter)) {
            // console.log("GOOD");
        } else {
            console.log("BAD! Not an integer number of Minimas!");
            console.log(([start_note].concat(middle_notes)).concat(end_note));
            console.log("Minimas: " + minim_counter);
        }
        // Given the total amount of minims in-between the "semibreves", see if they can be arranged in groups of 3
        // According to how many minims remain ungrouped (1, 2 or 0), modifiy the duration of the appropriate note of the sequence ('imperfection', 'alteration', no-modification)
        modification(minim_counter, start_note, middle_notes, end_note, following_note, 'minima', 'semibrevis');
    }
}

function sb_between_breves_processing(start_note, middle_notes, end_note, following_note, prolatio, note_durs, undotted_note_gain, dotted_note_gain) {
    var no_division_dot_flag = true;    // Default value
    var sequence = [start_note].concat(middle_notes);
    var first_dotted_note_index = find_first_dotted_note(sequence);
    console.log('1st dotted note index:', first_dotted_note_index);
    var dur, minim_counter, count_Sb, dot_element, part1_middle_notes, part2_middle_notes, minim_counter1, minim_counter2, part1_count_Sb, part2_count_Sb;
    var first_dotted_note, first_dotted_note_default_gain;

    // I have already taken into account that the minim could be dotted (and smaller values?),
    // the new note that could be dotted is the semibrevis. SO:

    // If first_dotted_note_index == -1, then there is no dot in the sequence at all
    if (first_dotted_note_index == -1) {
        // Getting the total of semibreves in the middle_notes
        minim_counter = counting_minims_in_an_undotted_sequence(middle_notes, note_durs, undotted_note_gain);
        count_Sb = minim_counter / (prolatio);
        console.log('No-dot\n');
    }

    // If first_dotted_note_index == 0, we have a dot at the start_note, which will make this note 'perfect' --> DOT OF PERFECTION. The other dots must be of augmentation (or perfection dots).
    else if (first_dotted_note_index == 0) {
        // DOT OF PERFECTION
        dot_element = get_next_element(start_note);
        dot_element.setAttribute('form', 'perf');
        console.log('Dot of perfection\n');
        // Getting the total of semibreves in the middle_notes
        minim_counter = counting_minims(middle_notes, note_durs, undotted_note_gain, dotted_note_gain, prolatio);
        count_Sb = minim_counter / (prolatio);
    }

    // Otherwise, if the dot is in any middle note:
    else {
        console.log('Dot in the middle of the sequence');
        first_dotted_note = sequence[first_dotted_note_index];////////////////////////////////////////
        dot_element = get_next_element(first_dotted_note);
        if (dot_element.hasAttribute('form')) {
            if (dot_element.getAttribute('form') == 'aug') {
                console.log('- I already knew about this AUG dot');
                //If the first dot is an already known dot of augmentation
                minim_counter = counting_minims(middle_notes, note_durs, undotted_note_gain, dotted_note_gain, prolatio);
                count_Sb = minim_counter / (prolatio);
            } else if (dot_element.getAttribute('form') == 'div') {
                console.log('- I already knew about this DIV dot');
                //If the first dot is an already known dot of division
                minim_counter = counting_minims_in_an_undotted_sequence(middle_notes, note_durs, undotted_note_gain);
                count_Sb = minim_counter / (prolatio);
            }
        } else {
            console.log('- Is this dot new? Lets divide the sequence in two and find out if it is a div/aug dot');
            // We have to divide the sequence of middle_notes in 2 parts: before the dot, and after the dot.
            // Then count the number of semibreves in each of the two parts to discover if this 'dot' is a
            // 'dot of division' or a 'dot of addition'
            part1_middle_notes = sequence.slice(1, first_dotted_note_index + 1);
            part2_middle_notes = sequence.slice(first_dotted_note_index + 1, sequence.length);

            // Semibreves BEFORE the first dot
            minim_counter1 = counting_minims_in_an_undotted_sequence(part1_middle_notes, note_durs, undotted_note_gain);
            part1_count_Sb = minim_counter1 / prolatio;

            // The individual value of the first dotted note (the last note in the sequence preceding the dot)
            dur = first_dotted_note.getAttribute('dur');
            first_dotted_note_default_gain = undotted_note_gain[note_durs.indexOf(dur)];
            // console.log("Notes in the Sequence preceding this dot " + part1_middle_notes);
            // console.log("FIRST DOTTED NOTE: " + first_dotted_note + ", with duration of: " + dur + ", which gain is: " + first_dotted_note_default_gain);

            // Taking the second part of the sequence of the middle notes (part2_middle_notes) into account
            // Count the number of semibreves in the second part of the sequence of middle_notes
            minim_counter2 = counting_minims(part2_middle_notes, note_durs, undotted_note_gain, dotted_note_gain, prolatio);
            part2_count_Sb = minim_counter2 / prolatio;


            // If there is just one semibreve before the first dot
            if (part1_count_Sb == 1) {
                console.log('-- Potential dot of div/aug');
                // Two possibilities: dot of division / dot of augmentation
                // We have to use the results of the second part of the middle notes (part2_middle_notes) to figure this out

                // If the number of semibreves after the dot is an integer number
                if (part2_count_Sb == Math.floor(part2_count_Sb)) {
                    console.log("--- Definitely a dot of division");
                    // DOT OF DIVISION
                    no_division_dot_flag = false;
                    // console.log('Imperfection app\n');
                    dot_element.setAttribute('form', 'div');
                    minim_counter = minim_counter1 + minim_counter2;
                    // Total of semibreves in the middle_notes
                    modification(part1_count_Sb, start_note, part1_middle_notes, null, null, 'semibrevis', 'brevis');
                    modification(part2_count_Sb, null, part2_middle_notes, end_note, following_note, 'semibrevis', 'brevis');
                } else {
                     console.log("--- Definitely a dot of augmentation");
                    // DOT OF AUGMENTATION
                    // console.log('Augmentation_typeI\n');
                    dot_element.setAttribute('form', 'aug');
                    first_dotted_note.setAttribute('dur.quality', 'perfecta');
                    first_dotted_note.setAttribute('num', '2');
                    first_dotted_note.setAttribute('numbase', '3');
                    minim_counter = minim_counter1 + (0.5 * first_dotted_note_default_gain) + minim_counter2;
                }
            }

            // If there is more than one semibreve before the first dot, it is impossible for that dot to be a 'dot of division'
            else {
                console.log('-- Cannot be a dot of division (could be perf/aug)');
                // DOT OF AUGMENTATION (or a dot of perfection at smaller note level)
                if (dot_element.hasAttribute('form') && dot_element.getAttribute('form') == 'perf') {
                    console.log("--- Definitely a dot of perfection");
                    minim_counter = counting_minims(middle_notes, note_durs, undotted_note_gain, dotted_note_gain, prolatio);
                }
                else {
                    console.log("--- Definitely a dot of augmentation");
                    // console.log('Augmentation_def\n');
                    dot_element.setAttribute('form', 'aug');
                    first_dotted_note.setAttribute('dur.quality', 'perfecta');
                    first_dotted_note.setAttribute('num', '2');
                    first_dotted_note.setAttribute('numbase', '3');
                    minim_counter = minim_counter1 + (0.5 * first_dotted_note_default_gain) + minim_counter2;
                }
            }

            // Total of semibreves in the middle_notes
            count_Sb = minim_counter / prolatio;
        }
    }

    if (no_division_dot_flag) {
        // Checking that the sequence of notes is fine, and then calling the modification function
        if (minim_counter % prolatio == 0) {
            // console.log("GOOD");
        } else {
            console.log("BAD! THE DIVISION IS NOT AN INTEGER NUMBER - not an integer number of Semibreves!");
            console.log(([start_note].concat(middle_notes)).concat(end_note));
            console.log("Semibreves: " + (minim_counter / prolatio));
        }
        // Given the total amount of semibreves in-between the "breves", see if they can be arranged in groups of 3
        // According to how many semibreves remain ungrouped (1, 2 or 0), modifiy the duration of the appropriate note of the sequence ('imperfection', 'alteration', no-modification)
        modification(count_Sb, start_note, middle_notes, end_note, following_note, 'semibrevis', 'brevis');
    }
}

function breves_between_longas_processing(start_note, middle_notes, end_note, following_note, prolatio, tempus, note_durs, undotted_note_gain, dotted_note_gain) {
    var no_division_dot_flag = true;    // Default value
    var sequence = [start_note].concat(middle_notes);
    var first_dotted_note_index = find_first_dotted_note(sequence);
    console.log('1st dotted note index:', first_dotted_note_index);
    var dur, minim_counter, count_B, dot_element, part1_middle_notes, part2_middle_notes, minim_counter1, minim_counter2, part1_count_B, part2_count_B;
    var first_dotted_note, first_dotted_note_default_gain;

    // If first_dotted_note_index == -1, then there is no dot in the sequence at all
    if (first_dotted_note_index == -1) {
        // Total of breves in the middle_notes
        minim_counter = counting_minims_in_an_undotted_sequence(middle_notes, note_durs, undotted_note_gain);
        count_B = minim_counter / (tempus * prolatio);
        console.log('No-dot\n');
    }

    // If first_dotted_note_index == 0, we have a dot at the start_note, which will make this note 'perfect' --> DOT OF PERFECTION. The other dots must be of augmentation (or perfection dots).
    else if (first_dotted_note_index == 0) {
        // DOT OF PERFECTION
        dot_element = get_next_element(start_note);
        dot_element.setAttribute('form', 'perf');
        console.log('Dot of perfection\n');
        // Total of breves in the middle_notes
        minim_counter = counting_minims(middle_notes, note_durs, undotted_note_gain, dotted_note_gain, prolatio, tempus);
        count_B = minim_counter / (tempus * prolatio);
    }

    // Otherwise, if the dot is in any middle note:
    else {
        console.log('Dot in the middle of the sequence');
        first_dotted_note = sequence[first_dotted_note_index];////////////////////////////////////////
        dot_element = get_next_element(first_dotted_note);
        if (dot_element.hasAttribute('form')) {
            if (dot_element.getAttribute('form') == 'aug') {
                console.log('- I already knew about this AUG dot');
                //If the first dot is an already known dot of augmentation
                minim_counter = counting_minims(middle_notes, note_durs, undotted_note_gain, dotted_note_gain, prolatio, tempus);
                count_B = minim_counter / (tempus * prolatio);
            } else if (dot_element.getAttribute('form') == 'div') {
                console.log('- I already knew about this DIV dot');
                //If the first dot is an already known dot of division
                minim_counter = counting_minims_in_an_undotted_sequence(middle_notes, note_durs, undotted_note_gain);
                count_B = minim_counter / (tempus * prolatio);
            }
        } else {
            console.log('- Is this dot new? Lets divide the sequence in two and find out if it is a div/aug dot');
            // We have to divide the sequence of middle_notes in 2 parts: before the dot, and after the dot.
            // Then count the number of breves in each of the two parts to discover if this 'dot' is a
            // 'dot of division' or a 'dot of addition'
            part1_middle_notes = sequence.slice(1, first_dotted_note_index + 1);
            part2_middle_notes = sequence.slice(first_dotted_note_index + 1, sequence.length);

            // Breves BEFORE the first dot
            minim_counter1 = counting_minims_in_an_undotted_sequence(part1_middle_notes, note_durs, undotted_note_gain);
            part1_count_B = minim_counter1 / (tempus*prolatio);
            
            // The individual value of the first dotted note (the last note in the sequence preceding the dot)
            first_dotted_note = part1_middle_notes[part1_middle_notes.length-1];
            dur = first_dotted_note.getAttribute('dur');
            first_dotted_note_default_gain = undotted_note_gain[note_durs.indexOf(dur)];

            // Taking the second part of the sequence of the middle notes (part2_middle_notes) into account
            // Count the number of breves in the second part of the sequence of middle_notes
            minim_counter2 = counting_minims(part2_middle_notes, note_durs, undotted_note_gain, dotted_note_gain, prolatio, tempus);
            part2_count_B = minim_counter2 / (tempus*prolatio);

            // If there is just one breve before the first dot
            if (part1_count_B == 1) {
                console.log('-- Potential dot of div/aug');
                // Two possibilities: dot of division / dot of augmentation
                // We have to take a look at the second part of the middle notes (part2_middle_notes) to figure this out

                // If the number of breves after the dot is an integer number
                if (part2_count_B == Math.floor(part2_count_B)) {
                    console.log("--- Definitely a dot of division");
                    // DOT OF DIVISION
                    no_division_dot_flag = false;
                    // console.log('Imperfection app\n');
                    dot_element.setAttribute('form', 'div');
                    minim_counter = minim_counter1 + minim_counter2;
                    // Total of breves in the middle_notes
                    modification(part1_count_B, start_note, part1_middle_notes, null, null, 'brevis', 'longa');
                    modification(part2_count_B, null, part2_middle_notes, end_note, following_note, 'brevis', 'longa');
                } else {
                    console.log("--- Definitely a dot of augmentation");
                    // DOT OF AUGMENTATION
                    // console.log('Augmentation_typeI\n');
                    dot_element.setAttribute('form', 'aug');
                    first_dotted_note.setAttribute('dur.quality', 'perfecta');
                    first_dotted_note.setAttribute('num', '2');
                    first_dotted_note.setAttribute('numbase', '3');
                    minim_counter = minim_counter1 + (0.5 * first_dotted_note_default_gain) + minim_counter2;
                }
            }

            // If there is more than one breve before the first dot, it is impossible for that dot to be a 'dot of division'
            else {
                console.log('-- Cannot be a dot of division (could be perf/aug)');
                // DOT OF AUGMENTATION (or a dot of perfection at smaller note level)
                if (dot_element.hasAttribute('form') && dot_element.getAttribute('form') == 'perf') {
                    console.log("--- Definitely a dot of perfection");
                    minim_counter = counting_minims(middle_notes, note_durs, undotted_note_gain, dotted_note_gain, prolatio, tempus);
                } else {
                    console.log("--- Definitely a dot of augmentation");
                    // console.log('Augmentation_def\n');
                    dot_element.setAttribute('form', 'aug');
                    first_dotted_note.setAttribute('dur.quality', 'perfecta');
                    first_dotted_note.setAttribute('num', '2');
                    first_dotted_note.setAttribute('numbase', '3');
                    minim_counter = minim_counter1 + (0.5 * first_dotted_note_default_gain) + minim_counter2;
                }
            }

            // Total of breves in the middle_notes
            count_B = minim_counter / (tempus * prolatio);
        }
    }
    console.log("TOTAL (m): " + minim_counter);
    console.log("TOTAL (Sb): " + (minim_counter / prolatio));
    console.log("TOTAL (B):  " + count_B);
    console.log();
        
    if (no_division_dot_flag) {
        // Checking that the sequence of notes is fine, and then calling the modification function
        if (minim_counter % (tempus * prolatio) == 0){
            // console.log("GOOD");
        } else {
            console.log("BAD! THE DIVISION IS NOT AN INTEGER NUMBER - not an integer number of Breves!");
            console.log(([start_note].concat(middle_notes)).concat(end_note));
            console.log("Breves: " + (minim_counter / (tempus * prolatio)));
        }
        // Given the total amount of breves in-between the "longas", see if they can be arranged in groups of 3
        // According to how many breves remain ungrouped (1, 2 or 0), modifiy the duration of the appropriate note of the sequence ('imperfection', 'alteration', no-modification)
        modification(count_B, start_note, middle_notes, end_note, following_note, 'brevis', 'longa');
    }
}

// Based on the mensuration, call the appropriate 'processing' function
function minims_between_semibreves(start_note, middle_notes, end_note, following_note, prolatio, note_durs, undotted_note_gain, dotted_note_gain) {
    if (prolatio == 3) {
        minims_between_semibreves_processing(start_note, middle_notes, end_note, following_note, note_durs, undotted_note_gain, dotted_note_gain);
    } // Else (@prolatio = 2), no modification on the semibreve-minim level is needed
}

function sb_between_breves(start_note, middle_notes, end_note, following_note, prolatio, tempus, note_durs, undotted_note_gain, dotted_note_gain) {
    if (tempus == 3) {
        sb_between_breves_processing(start_note, middle_notes, end_note, following_note, prolatio, note_durs, undotted_note_gain, dotted_note_gain);
    } // Else (@tempus = 2), no modification on the breve-semibreve level is needed
}

function breves_between_longas(start_note, middle_notes, end_note, following_note, prolatio, tempus, modusminor, note_durs, undotted_note_gain, dotted_note_gain) {
    // Use the counter of minims to determine the total of breves in the middle_notes 
    if (modusminor == 3) {
        breves_between_longas_processing(start_note, middle_notes, end_note, following_note, prolatio, tempus, note_durs, undotted_note_gain, dotted_note_gain);
    } else {
        // @modusminor = 2, no modification on the long-breve level is needed
        // Only display the results:
        var minim_counter = counting_minims_in_an_undotted_sequence(middle_notes, note_durs, undotted_note_gain);
        //var minim_counter = counting_minims(middle_notes, note_durs, undotted_note_gain, dotted_note_gain, prolatio, tempus, modusminor, null);
        console.log("TOTAL (m): " + minim_counter);
        var sb_counter = minim_counter / prolatio;
        console.log("TOTAL (Sb): " + sb_counter);
        var count_B = sb_counter / tempus;
        console.log("TOTAL (B):  " + count_B);
        console.log();
    }
}

// Coloration-related functions:
function find_note_level_of_coloration(modusmaior, modusminor, tempus, prolatio, colored_figures) {
    // Determine the note-level at which coloration is working (i.e., the perfect note it is meant to imperfect)
    var coloration_level;
    // If a maxima is colored, and the default value of the maxima is 3 (modusmaior = 3), then the coloration is working at the level of the maxima
    if (modusmaior == 3 && colored_figures.includes("maxima")) {
        coloration_level = "Max";
    }
    // If a longa is colored, and the default value of the longa is 3 (modusminor = 3), then the coloration is working at the level of the longa
    else if (modusminor == 3 && (colored_figures.includes("longa") || colored_figures.includes("maxima"))) {
        coloration_level = "L";
    }
    // If a breve is colored, and the default value of the breve is 3 (tempus = 3), then the coloration is working at the level of the breve
    else if (tempus == 3 && (colored_figures.includes("brevis") || colored_figures.includes("longa") || colored_figures.includes("maxima"))) {
        coloration_level = "B";
    }
    // If a semibreve is colored, and the default value of the semibreve is 3 (prolatio = 3), then the coloration is working at the level of the semibreve
    else if (prolatio == 3 && (colored_figures.includes("semibrevis") || colored_figures.includes("brevis") || colored_figures.includes("longa") || colored_figures.includes("maxima"))) {
        coloration_level = "Sb";
    }
    // Coloration can only work at these 4 levels, as only these four notes (i.e., maxima, longa, breve, and semibreve) can be perfect (i.e., have triple values)
    else {
        coloration_level = null;
    }
    return coloration_level;
}

function get_colored_notes_and_rests(noterest_sequence) {
    // List to store all the <note> and <rest> elements that have coloration
    var colored_notes_and_rests = [];
    // List to store the value (@dur) of these colored <note> and <rest> elements
    var colored_durs = [];
    for (var noterest of noterest_sequence) {
        // Find out if the note or rest is colored
        if (noterest.hasAttribute('colored')) {
            colored_notes_and_rests.push(noterest);
            // Fill the colroed_durs list with the duration (@dur) of these colored <note> and <rest> elements
            var dur = noterest.getAttribute('dur');
            if(!(colored_durs.includes(dur))) {
                colored_durs.push(dur);
                console.log(dur);
            }
        }
    }
    // Return both the list of all the colored notes and rests, and the list of the figuras (i.e., note shapes or @dur values) of these colored notes and rests
    return [colored_notes_and_rests, colored_durs];
}

function coloration_effect(notes_and_rests_per_voice, modusmaior, modusminor, tempus, prolatio) {
    // Apply the effect of coloration once found the note-level that coloration is working at.
    
    // This is done basically by multiplying by 2/3 the duration of all notes equal or larger than the coloration's note-level,
    // and keeping the values of the smaller colored notes the same as their original (uncolored) note values.
    
    // Get the list of colored <note> and <rest> elements
    var colored_noterests_durs = get_colored_notes_and_rests(notes_and_rests_per_voice);
    var colored_notes = colored_noterests_durs[0];
    var durs_of_colored_notes = colored_noterests_durs[1];
    // Get the note-level at which the coloration is working (i.e., the perect note it is meant to imperfect)
    var coloration_level = find_note_level_of_coloration(modusmaior, modusminor, tempus, prolatio, durs_of_colored_notes);
    console.log("Coloration level: " + coloration_level);

    // Given the note-level of the coloration (e.g., the breve), this note must be imperfect when colored.
    // For example: The colored breve is 2/3 the value of the uncolored breve, thus the former will have a @num = 3 and @numbase = 2.

    // Colored notes shorter than the note-level of the coloration will keep their original (uncolored) value.
    // Example continuation: Colored semibreves = uncolored semibreves, thus the former won't have any extra @num and @numbase attributes.

    // Colored notes larger than the note-level of the coloration, will remain perfect or imperfect as their uncolored versions,
    // but their total value will change since now they will be made up of imperfect (colored) units instead of perfect.
    // Example continuation: An uncolored long that is imperfect, normally consists of 2 PERFECT breves; the colored long, while still
    // imperfect, now consists of 2 IMPERFECT (COLORED) breves, thus its total duration changes:
    // colored_long = 2 x colored_breve = 2 x (2/3 x uncolored_breve)= 2/3 x (2 x uncolored_breve) = 2/3 x uncolored_long
    // The same happens with the maxima. Thus, the longa and the maxima will have @num = 2 and @numbase = 2.

    if (coloration_level == "Max") {
        for (var note of colored_notes) {
            // Multiplying the duration of the coloration's note-level and larger levels by 2/3
            if (note.getAttribute('dur') == "maxima") {
                note.setAttribute('num', '3');
                note.setAttribute('numbase', '2');
            } // For smaller notes, do nothing
        }
    } else if (coloration_level == "L") {
        for (var note of colored_notes) {
            // Multiplying the duration of the coloration's note-level and larger levels by 2/3
            if (note.getAttribute('dur') == "longa" || note.getAttribute('dur') == "maxima") {
                note.setAttribute('num', '3');
                note.setAttribute('numbase', '2');
            } // For smaller notes, do nothing
        }
    }
    else if (coloration_level == "B") {
        for (var note of colored_notes) {
            // Multiplying the duration of the coloration's note-level and larger levels by 2/3
            if (note.getAttribute('dur') == "brevis" || note.getAttribute('dur') == "longa" || note.getAttribute('dur') == "maxima") {
                note.setAttribute('num', '3');
                note.setAttribute('numbase', '2');
            } // For smaller notes, do nothing
        }
    }
    else if (coloration_level == "Sb") {
        for (var note of colored_notes) {
            // Multiplying the duration of the coloration's note-level and larger levels by 2/3
            if (note.getAttribute('dur') == "semibrevis" || note.getAttribute('dur') == "brevis" || note.getAttribute('dur') == "longa" || note.getAttribute('dur') == "maxima") {
                note.setAttribute('num', '3');
                note.setAttribute('numbase', '2');
            } // For smaller notes, do nothing
        }
    }
    else {
        for (var note of colored_notes) {
            note.setAttribute('num', '3');
            note.setAttribute('numbase', '2');
        }
    }
}

// Post processing functions
function replace_perfdots_by_divdots(meiDoc){
    // Replace dots of perfection (which I encoded with @form='perf') by dots of division (@form='div')
    const dots = meiDoc.getElementsByTagName('dot');
    for (var dot of dots) {
        // Find all dots classified as dots of 'perfection'
        if (dot.hasAttribute('form') && dot.getAttribute('form') == 'perf') {
            // Substitute them by dots of 'division'
            dot.setAttribute('form', 'div');
        }
    }
}

function process_augdots(modusmaior, modusminor, tempus, prolatio, staff) {
    // There are notes that, when dotted, the dot used must be a dot of augmentation
    // Only imperfect notes can be augmented by a dot, but not all dots in them are augmentation dots
    // These imperfect notes can be followed by a division dot, as they can form a perfection with a larger note.
    // If a note is perfect (according to the mensuration), by the functions above, all the dotted notes
    // with smaller values are examined to determine if the dot is a 'division dot' or an 'augmentation dot';
    // but in case of larger values, this is not evaluated in the previous functions.

    // The following code performs this action. It goes from 'maxima' to 'semibrevis', until if finds a perfect mensuration.
    // All the notes larger than that perfect note are considered to be augmented by any dot following them.
    var note_level = ['maxima', 'longa', 'brevis', 'semibrevis'];
    var mensuration = [modusmaior, modusminor, tempus, prolatio];
    var notes_NoDivisionDot_possibility = [];
    var k = 0;
    var acum_boolean = 1 * mensuration[0];
    //console.log("acum_boolean:");
    //console.log(acum_boolean);
    while (acum_boolean % 2 == 0) {
        notes_NoDivisionDot_possibility.push(note_level[k]);
        k += 1;
        try {
            acum_boolean += (1 * mensuration[k]);
        } catch(err) {
            break;
        }//console.log(acum_boolean);
    }
    //console.log(acum_boolean);
    //console.log(notes_NoDivisionDot_possibility);

    var dots, dot, dotted_note, dur_dotted_note;
    if (notes_NoDivisionDot_possibility.length != 0) {
        dots = staff.getElementsByTagName('dot');
        if (notes_NoDivisionDot_possibility.length == 4) {
            for (dot of dots) {
                dot.setAttribute('form', 'aug');
                dotted_note = get_preceding_noterest(dot);
                dotted_note.setAttribute('dur.quality', 'perfecta');
                dotted_note.setAttribute('num', '2');
                dotted_note.setAttribute('numbase', '3');
            }
        } else {
            for (dot of dots) {
                dotted_note = get_preceding_noterest(dot);
                // The preceding element of a dot should be either a <note> or a <rest>, so the following variable (dur_dotted_note) should be well defined
                dur_dotted_note = dotted_note.getAttribute('dur');
                if (notes_NoDivisionDot_possibility.includes(dur_dotted_note)) {
                    // Augmentation dot
                    dot.setAttribute('form', 'aug');
                    dotted_note.setAttribute('dur.quality', 'perfecta');
                    dotted_note.setAttribute('num', '2');
                    dotted_note.setAttribute('numbase', '3');
                }
            }
        }
    }
}

/*
    Main functions:
    These two functions deal with note alignment of the voices in the quasi-score.
    The process results in a score.
*/

// LineUp function
// Input: mensuration values, music content to process
// (could be just a chunk of the original voice's content)
// Process: It divides the music content into subsequences bounded by perfect notes. Then,
// each subsequence is processed to find which notes should be modified based on the context

function lineup_mensur_section(prolatio, tempus, modusminor, modusmaior, voice_content, staff) {

    // Individual note values and gains, according to the mensuration
    var note_durs = ['semifusa', 'fusa', 'semiminima', 'minima', 'semibrevis', 'brevis', 'longa', 'maxima'];
    var undotted_note_gain = [0.125, 0.25, 0.5, 1, 1 * prolatio, tempus * prolatio, modusminor * tempus * prolatio, modusmaior * modusminor * tempus * prolatio];
    var dotted_note_gain = [0.1875, 0.375, 0.75, 1.5, 3, 3 * prolatio, 3 * tempus * prolatio, 3 * modusminor * tempus * prolatio];
    console.log(note_durs);
    console.log(undotted_note_gain);
    console.log();

    // Getting all the notes and rests of one voice into an array (in order of appearance).
    // The array allows to retrieve the index, which is not possible with MEI lists.
    var voice_noterest_content = [];
    for (var element of voice_content) {
        var name = element.tagName;
        if (name == 'note' || name == 'rest') {
            voice_noterest_content.push(element);
        } else if (name == 'ligature') {
            //console.log("Got a ligature!");
            for (var child of element.children){
                if (child.tagName == 'note' || child.tagName == 'rest') {
                    voice_noterest_content.push(child);
                } else if (child.tagName == 'choice') {
                    // the relevant <note> and <rest> elements can be contained
                    // within a <corr> element within a <ligature> due to editorial
                    // corrections of parts of the ligature
                    var corr = child.getElementsByTagName('corr')[0];
                    for (var greatgrandchild of corr.children) {
                        if (greatgrandchild.tagName == 'note' || greatgrandchild.tagName == 'rest') {
                            voice_noterest_content.push(greatgrandchild);
                        } else {
                            console.log("This child of corr (within the choice tag in a ligature) is not a note/rest:");
                            console.log(greatgrandchild);
                            console.log("It is a " + greatgrandchild.tagName);
                        }
                    }
                } else {
                    console.log("This child of ligature is not a note/rest/choice:");
                    console.log(child);
                    console.log("It is a " + child.tagName);
                }
            }
        } else if (name == 'choice'){
            // The relevant <note> and <rest> elements can be contained
            // within a <corr> element due to editorial corrections
            var corr = element.getElementsByTagName('corr')[0];
            for (var child of corr.children) {
                if (child.tagName == 'note' || child.tagName == 'rest') {
                    voice_noterest_content.push(child);
                } else {
                    console.log("This child of corr is not a note/rest:");
                    console.log(child);
                    console.log("It is a " + child.tagName);
                }
            }
        } else {
            console.log("Unexpected tagnme : " + name + "\n(not a note, rest, ligature, or choice)\n");
        }
    }//console.log(voice_noterest_content);

    // Encoding the effect of coloration in the durational values of the colored notes/rests
    coloration_effect(voice_noterest_content, modusmaior, modusminor, tempus, prolatio);

    // Find indices for starting and ending points of each sequence of notes to be analyzed.
    // Each of the following is a list of indices of notes greater or equal than: a Semibreve, a Breve, a Long and a Maxima, respectively.
    var list_of_indices_geq_Sb = [];
    var list_of_indices_geq_B = [];
    var list_of_indices_geq_L = [];
    var list_of_indices_geq_Max = [];
    // Get the indices
    for (var noterest of voice_noterest_content) {
        var dur = noterest.getAttribute('dur');
        if (dur == 'semibrevis' || noterest.hasAttribute('colored')) {
            list_of_indices_geq_Sb.push(voice_noterest_content.indexOf(noterest));
        }
        if (dur == 'brevis' || noterest.hasAttribute('colored')) {
            list_of_indices_geq_Sb.push(voice_noterest_content.indexOf(noterest));
            list_of_indices_geq_B.push(voice_noterest_content.indexOf(noterest));
        }
        if (dur == 'longa' || noterest.hasAttribute('colored')) {
            list_of_indices_geq_Sb.push(voice_noterest_content.indexOf(noterest));
            list_of_indices_geq_B.push(voice_noterest_content.indexOf(noterest));
            list_of_indices_geq_L.push(voice_noterest_content.indexOf(noterest));
        }
        if (dur == 'maxima' || noterest.hasAttribute('colored')) {
            list_of_indices_geq_Sb.push(voice_noterest_content.indexOf(noterest));
            list_of_indices_geq_B.push(voice_noterest_content.indexOf(noterest));
            list_of_indices_geq_L.push(voice_noterest_content.indexOf(noterest));
            list_of_indices_geq_Max.push(voice_noterest_content.indexOf(noterest));
        }
    }


    var o, f, start_note, end_note, middle_notes, following_note;

    // PROCESSING OF MINIMS AND SEMIBREVES (REGARDLESS OF THE @PROLATIO)
    // SEQUENCES OF MINIMS DELIMITED BY SEMIBREVES (OR HIGHER NOTE VALUES)

    console.log("\nSEMIBREVE GEQ");
    console.log(list_of_indices_geq_Sb + "\n");
    if (!(list_of_indices_geq_Sb.includes(0)) && list_of_indices_geq_Sb.length != 0) {
        start_note = null;
        f = list_of_indices_geq_Sb[0];
        end_note = voice_noterest_content[f];
        try {
            following_note = voice_noterest_content[f+1];
        } catch(err) {
            following_note = null;
        }
        middle_notes = voice_noterest_content.slice(0, f);

        //DEBUG:
        var s = null;
        var e = end_note.getAttribute('pname') + end_note.getAttribute('oct') + " " + end_note.getAttribute('dur');
        var m = "";
        for (var midnote of middle_notes){
            var attribs = midnote.getAttribute('pname') + midnote.getAttribute('oct') + " " + midnote.getAttribute('dur');
            if (attribs == '0 null'){
                m += midnote.tagName + ", ";
            } else {
                m += attribs + ", ";
            }
        } console.log("Delimited Sequence of Minims: " + s + ", " + m + e);

        minims_between_semibreves(start_note, middle_notes, end_note, following_note, prolatio, note_durs, undotted_note_gain, dotted_note_gain);
    }

    for (var j = 0; j < list_of_indices_geq_Sb.length-1; j++) {
        // Define the sequence of notes
        o = list_of_indices_geq_Sb[j];
        start_note = voice_noterest_content[o];
        f = list_of_indices_geq_Sb[j+1];
        end_note = voice_noterest_content[f];
        try {
            following_note = voice_noterest_content[f+1];
        } catch(err) {
            following_note = null;
        }
        middle_notes = voice_noterest_content.slice(o+1, f);

        //DEBUG:
        var s = start_note.getAttribute('pname') + start_note.getAttribute('oct') + " " + start_note.getAttribute('dur');
        var e = end_note.getAttribute('pname') + end_note.getAttribute('oct') + " " + end_note.getAttribute('dur');
        var m = "";
        for (var midnote of middle_notes){
            var attribs = midnote.getAttribute('pname') + midnote.getAttribute('oct') + " " + midnote.getAttribute('dur');
            if (attribs == '0 null'){
                m += midnote.tagName + ", ";
            } else {
                m += attribs + ", ";
            }
        } console.log("Delimited Sequence of Minims: " + s + ", " + m + e);
        minims_between_semibreves(start_note, middle_notes, end_note, following_note, prolatio, note_durs, undotted_note_gain, dotted_note_gain);
    }


    // PROCESSING OF SEMIBREVES AND BREVES (REGARDLESS OF THE @TEMPUS)
    // SEQUENCES OF SEMIBREVES DELIMITED BY BREVES (OR HIGHER NOTE VALUES)

    console.log("\nBREVE GEQ");
    console.log(list_of_indices_geq_B + "\n");
    if (!(list_of_indices_geq_B.includes(0)) && list_of_indices_geq_B.length != 0) {
        start_note = null;
        f = list_of_indices_geq_B[0];
        end_note = voice_noterest_content[f];
        try {
            following_note = voice_noterest_content[f+1];
        } catch(err) {
            following_note = null;
        }
        middle_notes = voice_noterest_content.slice(0, f);

        //DEBUG:
        var s = null;
        var e = end_note.getAttribute('pname') + end_note.getAttribute('oct') + " " + end_note.getAttribute('dur');
        var m = "";
        for (var midnote of middle_notes){
            var attribs = midnote.getAttribute('pname') + midnote.getAttribute('oct') + " " + midnote.getAttribute('dur');
            if (attribs == '0 null'){
                m += midnote.tagName + ", ";
            } else {
                m += attribs + ", ";
            }
        } console.log("Delimited Sequence of Semibreves: " + s + ", " + m + e);

        sb_between_breves(start_note, middle_notes, end_note, following_note, prolatio, tempus, note_durs, undotted_note_gain, dotted_note_gain);
    }

    for (var j = 0; j < list_of_indices_geq_B.length-1; j++) {
        // Define the sequence of notes
        o = list_of_indices_geq_B[j];
        start_note = voice_noterest_content[o];
        f = list_of_indices_geq_B[j+1];
        end_note = voice_noterest_content[f];
        try {
            following_note = voice_noterest_content[f+1];
        } catch(err) {
            following_note = null;
        }
        middle_notes = voice_noterest_content.slice(o+1, f);

        //DEBUG:
        var s = start_note.getAttribute('pname') + start_note.getAttribute('oct') + " " + start_note.getAttribute('dur');
        var e = end_note.getAttribute('pname') + end_note.getAttribute('oct') + " " + end_note.getAttribute('dur');
        var m = "";
        for (var midnote of middle_notes){
            var attribs = midnote.getAttribute('pname') + midnote.getAttribute('oct') + " " + midnote.getAttribute('dur');
            if (attribs == '0 null'){
                m += midnote.tagName + ", ";
            } else {
                m += attribs + ", ";
            }
        } console.log("Delimited Sequence of Semibreves: " + s + ", " + m + e);
        sb_between_breves(start_note, middle_notes, end_note, following_note, prolatio, tempus, note_durs, undotted_note_gain, dotted_note_gain);
    }


    // PROCESSING OF BREVES AND LONGAS (REGARDLESS OF THE @MODUSMINOR)
    // SEQUENCES OF BREVES DELIMITED BY LONGAS (OR HIGHER NOTE VALUES)

    console.log("\nLONGA GEQ");
    console.log(list_of_indices_geq_L + "\n");

    // Empty list (no 'longas' or 'maximas' at all in the voice)
    if(list_of_indices_geq_L.length == 0) {
        // Define the sequence of notes
        start_note = null;
        end_note = null;
        middle_notes = voice_noterest_content.slice(0, voice_noterest_content.length);

        //DEBUG:
        var s = null;
        var e = null;
        var m = "";
        for (var midnote of middle_notes){
            var attribs = midnote.getAttribute('pname') + midnote.getAttribute('oct') + " " + midnote.getAttribute('dur');
            if (attribs == '0 null'){
                m += midnote.tagName + ", ";
            } else {
                m += attribs + ", ";
            }
        } console.log("Delimited Sequence of Breves: " + s + ", " + m + e);

        breves_between_longas(start_note, middle_notes, end_note, following_note, prolatio, tempus, modusminor, note_durs, undotted_note_gain, dotted_note_gain);
    }

    // At least one long or maxima:
    else {

        if (!(list_of_indices_geq_L.includes(0))) {
            // Define the sequence of notes
            start_note = null;
            f = list_of_indices_geq_L[0];
            end_note = voice_noterest_content[f];
            try {
                following_note = voice_noterest_content[f+1];
            } catch(err) {
                following_note = null;
            }
            middle_notes = voice_noterest_content.slice(0, f);

            //DEBUG:
            var s = null;
            var e = end_note.getAttribute('pname') + end_note.getAttribute('oct') + " " + end_note.getAttribute('dur');
            var m = "";
            for (var midnote of middle_notes){
                var attribs = midnote.getAttribute('pname') + midnote.getAttribute('oct') + " " + midnote.getAttribute('dur');
                if (attribs == '0 null'){
                    m += midnote.tagName + ", ";
                } else {
                    m += attribs + ", ";
                }
            } console.log("Delimited Sequence of Breves: " + s + ", " + m + e);

            breves_between_longas(start_note, middle_notes, end_note, following_note, prolatio, tempus, modusminor, note_durs, undotted_note_gain, dotted_note_gain);
        }

        for (var j = 0; j < list_of_indices_geq_L.length-1; j++) {
            // Define the sequence of notes
            o = list_of_indices_geq_L[j];
            start_note = voice_noterest_content[o];
            f = list_of_indices_geq_L[j+1];
            end_note = voice_noterest_content[f];
            try {
                following_note = voice_noterest_content[f+1];
            } catch(err) {
                following_note = null;
            }
            middle_notes = voice_noterest_content.slice(o+1, f);

            //DEBUG:
            var s = start_note.getAttribute('pname') + start_note.getAttribute('oct') + " " + start_note.getAttribute('dur');
            var e = end_note.getAttribute('pname') + end_note.getAttribute('oct') + " " + end_note.getAttribute('dur');
            var m = "";
            for (var midnote of middle_notes){
                var attribs = midnote.getAttribute('pname') + midnote.getAttribute('oct') + " " + midnote.getAttribute('dur');
                if (attribs == '0 null'){
                    m += midnote.tagName + ", ";
                } else {
                    m += attribs + ", ";
                }
            } console.log("Delimited Sequence of Breves: " + s + ", " + m + e);

            breves_between_longas(start_note, middle_notes, end_note, following_note, prolatio, tempus, modusminor, note_durs, undotted_note_gain, dotted_note_gain);;
        }

        // If the last note on the voice_noterest_content isn't a longa (or maxima):
        var index_last_noterest = voice_noterest_content.length - 1;
        if (!(list_of_indices_geq_L.includes(index_last_noterest))) {
            o = list_of_indices_geq_L[list_of_indices_geq_L.length - 1];
            start_note = voice_noterest_content[o];
            end_note = null;
            following_note = null;
            middle_notes = voice_noterest_content.slice(o+1,index_last_noterest+1);

            //DEBUG:
            var s = start_note.getAttribute('pname') + start_note.getAttribute('oct') + " " + start_note.getAttribute('dur');
            var e = null;
            var m = "";
            for (var midnote of middle_notes){
                var attribs = midnote.getAttribute('pname') + midnote.getAttribute('oct') + " " + midnote.getAttribute('dur');
                if (attribs == '0 null'){
                    m += midnote.tagName + ", ";
                } else {
                    m += attribs + ", ";
                }
            } console.log("Delimited Sequence of Breves: " + s + ", " + m + e);

            breves_between_longas(start_note, middle_notes, end_note, following_note, prolatio, tempus, modusminor, note_durs, undotted_note_gain, dotted_note_gain);
        }
    }
    // Post-process: Unspecified dots are assigned a @form = 'aug' value
    process_augdots(modusmaior, modusminor, tempus, prolatio, staff);
}

// Main function: lining_up
// Divides each voice into chunks with fixed mensuration values, and calls the
// lineup_mensur_section function that takes care of lining up the chunk based
// on the mensuration values

const lining_up = quasiscore_mensural_doc => {

    // For each voice (staff element) in the "score"
    var staves = quasiscore_mensural_doc.getElementsByTagName('staff');
    var stavesDef = quasiscore_mensural_doc.getElementsByTagName('staffDef');

    for (var i = 0; i < stavesDef.length; i++) {
        console.log('\nVoice # ' + (i + 1) + ' results:\n');

        // A. Get the mensuration information of the voice
        var staffDef_mensur = stavesDef[i].getElementsByTagName('mensur')[0];
        var prolatio = staffDef_mensur.getAttribute('prolatio');
        var tempus = staffDef_mensur.getAttribute('tempus');
        var modusminor = staffDef_mensur.getAttribute('modusminor');
        var modusmaior = staffDef_mensur.getAttribute('modusmaior');

        // B. Get the voice content
        var staff = staves[i];
        var voice_content = Array.from(staff.getElementsByTagName('layer')[0].children);

        // C. Retrieve all mensur elements in the voice (are there chagnes in mensuration?)
        const mensur_elements = Array.from(staff.getElementsByTagName('mensur'));

        // If there are any, separate the voice_content into chunks (of fixed mensuration)
        // and process each of them individually by calling the lineup_mensur_section function
        if (mensur_elements.length == 0) {
            lineup_mensur_section(prolatio, tempus, modusminor, modusmaior, voice_content, staff);
        } else {
            var start, mensur_index, chunk;
            start = 0;
            for (var mensur of mensur_elements) {
                // Retrieve notes for that chunk
                mensur_index = voice_content.indexOf(mensur);
                chunk = voice_content.slice(start, mensur_index);
                lineup_mensur_section(prolatio, tempus, modusminor, modusmaior, chunk, staff);
                // Update mensuration and starting parameters for next chunk
                start = mensur_index + 1;
                prolatio = mensur.getAttribute('prolatio');
                tempus = mensur.getAttribute('tempus');
                modusminor = mensur.getAttribute('modusminor');
                modusmaior = mensur.getAttribute('modusmaior');
            }chunk = voice_content.slice(start,);
            lineup_mensur_section(prolatio, tempus, modusminor, modusmaior, chunk, staff);
        }
    }
    // Post-processing: All dots of perfection (which for now have a @form = 'perf')
    // are assigned a @form = 'div' value
    replace_perfdots_by_divdots(quasiscore_mensural_doc);

    // Return result (the input quasiscore has been converted into a score by now)
    return quasiscore_mensural_doc;
};

exports.lining_up = lining_up;

  };
  defs["./ArsAntiqua.js"] = function (module, exports, require) { const console = quiet;
/*
    DURATION FINDER MODULE FOR ARS ANTIQUA
    Figure out the duration of the notes in the individual <staff> elements.

    Ars Antiqua is characterized by the following:
    1. Absence of 'minims'
    2. Absence of 'prolatio' and 'modusmaior'
    3. The 'breve' can't be identified as 'perfect' or 'imperfect'.
       It is just considered to be equal to 3 minor semibreves, or a pair of minor-major semibreves,
       or it is equal to 2 equal-duration semibreves.
    4. The fact that the 'breve' can't be catalogued as 'perfect' or 'imperfect', implies that the 'semibreve' can't be 'altered.
       It just can be 'maior' or 'minor'.
    5. There are no 'maximas' just 'duplex longas'
    6. There is no dot of augmentation (this was introduced in the Ars nova).
       Therefore, there is no issue regarding the distiction between dot's functionality (division vs. augmentation).
       In other words, in Ars antiqua, all dots are dots of division.
*/
const Fraction = require('fraction.js');

// Functions about preceding and following note/rest elements
function get_preceding_noterest(target_element) {
    var preceding_element = target_element.previousElementSibling;
    while (preceding_element.tagName != 'note' && preceding_element.tagName != 'rest'){
        preceding_element = preceding_element.previousElementSibling;
    } return preceding_element;
}

function get_following_noterest(target_element) {
    var following_element = target_element.nextElementSibling;
    while (following_element.tagName != 'note' && following_element.tagName != 'rest'){
        following_element = following_element.nextElementSibling;
    } return following_element;
}

// Functions related to dots
function followed_by_dot(target_element) {
    // Boolean function evaluating the condition 'followed by dot'
    var next_element = target_element.nextElementSibling;
    if (next_element != null && next_element.tagName == 'dot') {
        return true;
    } else {
        return false;
    }
}

function find_first_dotted_note(sequence) {
    // Returns the first note element in a sequence which is followed by a dot
    var first_dotted_note;
    for (var note of sequence) {
        if (followed_by_dot(note)){
            first_dotted_note = note;
            break;
        }
    } return first_dotted_note;
}

function dot_of_imperfection(sequence, note_durs, undotted_note_gain, tempus, count_B) {
    var first_dotted_note = find_first_dotted_note(sequence);
    if (first_dotted_note == null) {return false;}

    // We have to divide the sequence of middle_notes in 2 parts: before the dot, and after the dot.
    // Then count the number of breves in each of the two parts to discover if this 'dot' is a
    // 'dot of division' or a 'dot of addition'
    var part1_middle_notes = sequence.slice(0, sequence.indexOf(first_dotted_note) + 1);

    // Breves BEFORE the first dot
    console.log("Part 1 - preceding the dot:");
    var sb_counter1 = counting_semibreves(part1_middle_notes, note_durs, undotted_note_gain);
    var part1_count_B = sb_counter1 / tempus;
    var status = false;

    // If there is just one breve before the first dot
    // And two/three breves between the longs (only case where a dot
    // of imperfection is used to change the default interpretation)
    if (part1_count_B == 1 && (count_B == 2 || count_B == 3)) {
        var dur_before_dot = first_dotted_note.getAttribute('dur');
        var dur_after_dot = get_following_noterest(first_dotted_note).getAttribute('dur');
        // Muris: But if the dot is placed between two semibreves,
        // it is attributed with division of tempus.
        // Checking that this is not the case, then this would be a dot of imperfection
        if (dur_before_dot != 'semibrevis' || dur_after_dot != 'semibrevis') {
            status = true;
            console.log("\nDot of Imperfection");
        }
    } return status;
}

// Auxiliary function
function has_been_modified(note) {
    return (note.hasAttribute('num') && note.hasAttribute('numbase'));
}

// Functions related to the counting of semibreves in a sequence of notes
function counting_semibreves(sequence_of_notes, note_durs, undotted_note_gain) {
    var sb_counter, note, dur, index, gain, ratio;
    sb_counter = 0;
    console.log('@dur\t\tCounter (Sb)\tAccumulator (Sb)');
    for (note of sequence_of_notes) {
        dur = note.getAttribute('dur');
        try {
            index = note_durs.indexOf(dur);
        }
        catch(err) {
            console.log("MISTAKE\nNote/Rest element not considered: " + note + ", with a duration @dur = " + dur);
        }
        gain = undotted_note_gain[index];
        if (note.hasAttribute('num') && note.hasAttribute('numbase')) {
            ratio = new Fraction([note.getAttribute('numbase'), note.getAttribute('num')]);
            gain = ratio.mul(gain);
        }
        sb_counter += gain;
        console.log(dur + Array(10-dur.length).join(' ') + "\t" + gain + "\t\t" + sb_counter);
    }
    return sb_counter;
}

// Modification function at the long-breve level:
function breves_between_longas(start_note, middle_notes, end_note, following_note, tempus, note_durs, undotted_note_gain, modusminor) {
    // Total of breves in the middle_notes
    // 1. Pre-processing: Filtering. Remove the 'dot' elements (and other group markings, such as 'Group_Begin' and 'Group_End')
    // from the middle_notes list, so that this list only contains notes and rests that lie between the longs.
    var sequence_of_middle_notes = [];
    for (var element of middle_notes){
        if (element.tagName!='dot' && element.tagName!='Group_Begin' && element.tagName!='Group_End'){
            sequence_of_middle_notes.push(element);
        }
    }
    // 2. Use the counter of semibreves to determine the total of breves in the middle_notes
    var sb_counter = counting_semibreves(sequence_of_middle_notes, note_durs, undotted_note_gain);
    console.log("TOTAL (Sb): " + sb_counter);
    var count_B = sb_counter / tempus;
    console.log("TOTAL (B):  " + count_B);
    console.log();

    if (modusminor == 3){
        modification(count_B, start_note, sequence_of_middle_notes, end_note, following_note, 'brevis', 'longa', note_durs, undotted_note_gain, tempus);
    } // Else (@modusminor = 2), no modification on the long-breve level is needed
}

function modification(counter, start_note, middle_notes, end_note, following_note, short_note, long_note, note_durs, undotted_note_gain, tempus) {
    // Given the total amount of "breves" in-between the "longs", see if they can be arranged in groups of 3
    // According to how many breves remain ungrouped (1, 2 or 0), modify the duration of the appropriate note of the sequence ('imperfection', 'alteration', no-modification)
    var last_middle_note, last_uncolored_note;

    switch(counter % 3) {

        case 1: // 1 breve left out:

            if (start_note != null && start_note.tagName == 'note' && start_note.getAttribute('dur') == long_note && !(has_been_modified(start_note)) && !(followed_by_dot(start_note))) {
            // Default Case
                // Imperfection a.p.p.
                console.log("Default Case:\tImperfection a.p.p.\n");
                start_note.setAttribute('dur.quality', 'imperfecta');
                start_note.setAttribute('num', '3');
                start_note.setAttribute('numbase', '2');
            }

            else if (end_note != null && end_note.tagName == 'note' && end_note.getAttribute('dur') == long_note && !(has_been_modified(end_note)) && !(followed_by_dot(end_note))) {
            // Exception Case
                // Imperfection a.p.a.
                console.log("Alternative Case:  Imperfection a.p.a.\n");
                end_note.setAttribute('dur.quality', 'imperfecta');
                end_note.setAttribute('num', '3');
                end_note.setAttribute('numbase', '2');
                // Raise a warning when this imperfect note is followed by a perfect note (contradiction with the first rule)
                if (following_note != null && following_note.getAttribute('dur') == long_note) {
                    console.log("WARNING 1! An imperfection a.p.a. is required, but this imperfect note is followed by a perfect note, this contradicts the fundamental rule: 'A note is perfect before another one of the same kind'.");
                    console.log("The imperfected note is " + end_note + " and is followed by the perfect note " + following_note + "\n");
                }
            }

            else {
            // Mistake Case
                console.log("MISTAKE 1 - Impossible to do Imperfection a.p.p. and also Imperfection a.p.a.");
                console.log(start_note);
                console.log(end_note);
                console.log("\n");
            } break;

        case 2: // 2 breves left out:
            // One of he possibilities when 2 breves are left out, is alteration
            // One must alter the last (uncolored) note from the middle_notes of the sequence
            last_middle_note = middle_notes[middle_notes.length - 1];
            // If the last note is uncolored, it is a candidate for alteration (given that it is a note and not a rest, and that it is a breve and not a smaller value)
            last_uncolored_note = last_middle_note;
            // But if it is colored, we need to find the last "uncolored" note, as this is the one that would be altered
            while (last_uncolored_note.hasAttribute('colored')){
                last_uncolored_note = get_preceding_noterest(last_uncolored_note);
            }

            if (counter == 2) { // 2 exact breves between the longs

                if (last_uncolored_note.tagName == 'note' && last_uncolored_note.getAttribute('dur') == short_note && !(has_been_modified(last_uncolored_note))) {
                    // Exception (dot of imperfection)
                    if (dot_of_imperfection(middle_notes, note_durs, undotted_note_gain, tempus, counter)) {
                        console.log("Alternative Case:  Imperfection a.p.p. & Imperfection a.p.a.\n");
                        // Imperfection a.p.p.
                        start_note.setAttribute('dur.quality', 'imperfecta');
                        start_note.setAttribute('num', '3');
                        start_note.setAttribute('numbase', '2');
                        // Imperfection a.p.a.
                        end_note.setAttribute('dur.quality', 'imperfecta');
                        end_note.setAttribute('num', '3');
                        end_note.setAttribute('numbase', '2');
                        // Raise a warning when this imperfect note is followed by a perfect note (contradiction with the first rule)
                        if (following_note != null && following_note.getAttribute('dur') == long_note) {
                            console.log("WARNING 2! An imperfection a.p.a. is required, but this imperfect note is followed by a perfect note, this contradicts the fundamental rule: 'A note is perfect before another one of the same kind'.");
                            console.log("The imperfected note is " + end_note + " and is followed by the perfect note " + following_note);
                            console.log("\n");
                        }
                    }
                    // Default case: Alteration
                    else {
                        console.log("Default Case:\tAlteration\n");
                        last_uncolored_note.setAttribute('dur.quality', 'altera');
                        last_uncolored_note.setAttribute('num', '1');
                        last_uncolored_note.setAttribute('numbase', '2');
                    }
                }

                else if ((start_note != null && start_note.tagName == 'note' && start_note.getAttribute('dur') == long_note && !(has_been_modified(start_note)) && !(followed_by_dot(start_note))) && (end_note != null && end_note.tagName == 'note' && end_note.getAttribute('dur') == long_note && !(has_been_modified(end_note)) && !(followed_by_dot(end_note)))) {
                // Exception Case
                    console.log("Alternative Case:  Imperfection a.p.p. & Imperfection a.p.a.\n");
                    // Imperfection a.p.p.
                    start_note.setAttribute('dur.quality', 'imperfecta');
                    start_note.setAttribute('num', '3');
                    start_note.setAttribute('numbase', '2');
                    // Imperfection a.p.a.
                    end_note.setAttribute('dur.quality', 'imperfecta');
                    end_note.setAttribute('num', '3');
                    end_note.setAttribute('numbase', '2');
                    // Raise a warning when this imperfect note is followed by a perfect note (contradiction with the first rule)
                    if (following_note != null && following_note.getAttribute('dur') == long_note) {
                        console.log("WARNING 2! An imperfection a.p.a. is required, but this imperfect note is followed by a perfect note, this contradicts the fundamental rule: 'A note is perfect before another one of the same kind'.");
                        console.log("The imperfected note is " + end_note + " and is followed by the perfect note " + following_note);
                        console.log("\n");
                    }
                }

                else {
                // Mistake Case
                    console.log("MISTAKE 2 - Alteration is impossible - Imperfections a.p.p. and a.p.a. are also impossible");
                    console.log(start_note);
                    console.log(end_note);
                    console.log("\n");
                }

            } else { // 5, 8, 11, 14, 17, 20, ... breves between the longs
                console.log(last_uncolored_note);
                // Default Case: Check the conditions to apply the 'default interpretation', which implies imperfection a.p.a.

                if ((start_note != null && start_note.tagName == 'note' && start_note.getAttribute('dur') == long_note && !(has_been_modified(start_note)) && !(followed_by_dot(start_note))) && (end_note != null && end_note.tagName == 'note' && end_note.getAttribute('dur') == long_note && !(has_been_modified(end_note)) && !(followed_by_dot(end_note)))) {
                    // Check if imperfection a.p.a. enters or not in conflict with rule # 1.
                    if (following_note != null && following_note.getAttribute('dur') == long_note) {
                        // If it does, imperfection a.p.a. is discarded, except if the "alternative interpretation" (the 'Exception Case') is also forbidden
                        if (last_uncolored_note.tagName == 'note' && last_uncolored_note.getAttribute('dur') == short_note && !(has_been_modified(last_uncolored_note))) {
                        // Exception Case
                            // Alteration
                            console.log("Alternative Case:  Alteration\n");
                            last_uncolored_note.setAttribute('dur.quality', 'altera');
                            last_uncolored_note.setAttribute('num', '1');
                            last_uncolored_note.setAttribute('numbase', '2');
                        }
                        else {
                        // Default + Warning Case
                            console.log("Default Case:\tImperfection a.p.p. & Imperfection a.p.a.\n");
                            // If the "alternative interpretation" is forbidden, and imperfection a.p.a. was discarded just because it entered in conflict with rule # 1
                            // (this is, impapa_against_rule1 flag is True), then we force imperfection a.p.a. as it is the only viable option. But we also raise a 'warning'
                            // Imperfection a.p.p.
                            start_note.setAttribute('dur.quality', 'imperfecta');
                            start_note.setAttribute('num', '3');
                            start_note.setAttribute('numbase', '2');
                            // Imperfection a.p.a.
                            end_note.setAttribute('dur.quality', 'imperfecta');
                            end_note.setAttribute('num', '3');
                            end_note.setAttribute('numbase', '2');
                            // Raise a warning when this imperfect note is followed by a perfect note (contradiction with the first rule)
                            console.log("WARNING 3n + 2! An imperfection a.p.a. is required, but this imperfect note is followed by a perfect note, this contradicts the fundamental rule: 'A note is perfect before another one of the same kind'.");
                            console.log("The imperfected note is " + end_note + " and is followed by the perfect note " + following_note);
                            console.log("\n");
                        }
                    // If it does not enter in conflict, we go with the "Default interpretation" of the notes
                    } else {
                    // Default Case
                        console.log("Default Case:\tImperfection a.p.p. & Imperfection a.p.a.\n");
                        // Imperfection a.p.p.
                        start_note.setAttribute('dur.quality', 'imperfecta');
                        start_note.setAttribute('num', '3');
                        start_note.setAttribute('numbase', '2');
                        // Imperfection a.p.a.
                        end_note.setAttribute('dur.quality', 'imperfecta');
                        end_note.setAttribute('num', '3');
                        end_note.setAttribute('numbase', '2');
                    }
                }

                else if (last_uncolored_note.tagName == 'note' && last_uncolored_note.getAttribute('dur') == short_note && !(has_been_modified(last_uncolored_note))) {
                // Exception Case
                    // Alteration
                    console.log("Alternative Case:  Alteration\n");
                    last_uncolored_note.setAttribute('dur.quality', 'altera');
                    last_uncolored_note.setAttribute('num', '1');
                    last_uncolored_note.setAttribute('numbase', '2');
                }

                else {// Mistake Case
                    console.log("MISTAKE 3n + 2 - Imperfections a.p.p. and a.p.a. are impossible - Alteration is also impossible");
                    console.log(start_note);
                    console.log(end_note);
                    console.log("\n");
                }

            } break;

        case 0: // 0 breves left out:

            if (counter == 0) {
                // When 0 breves left out, no modifications to perform
                console.log("Default Case:\tNo modifications\n");
            }

            else if (counter == 3) {
                // One of the possibilities when 3 breves are left out, involves alteration
                // One must alter the last (uncolored) note from the middle_notes of the sequence
                last_middle_note = middle_notes[middle_notes.length - 1];
                // If the last note is uncolored, it is a candidate for alteration (given that it is a note and not a rest, and that it is a breve and not a smaller value)
                last_uncolored_note = last_middle_note;
                // But if it is colored, we need to find the last "uncolored" note, as this is the one that would be altered
                while (last_uncolored_note.hasAttribute('colored')) {
                    last_uncolored_note = get_preceding_noterest(last_uncolored_note);
                }

                // When 3 breves left out, no modifications to perform,
                // Except in the presence of a dot of imperfection
                if (dot_of_imperfection(middle_notes, note_durs, undotted_note_gain, tempus, counter)) {
                // Exception: dot of imperfection
                    console.log("Alternative Case:\tImperfection a.p.p. & Alteration\n");
                    // Imperfection a.p.p.
                    start_note.setAttribute('dur.quality', 'imperfecta');
                    start_note.setAttribute('num', '3');
                    start_note.setAttribute('numbase', '2');
                    // Alteration
                    last_uncolored_note.setAttribute('dur.quality', 'altera');
                    last_uncolored_note.setAttribute('num', '1');
                    last_uncolored_note.setAttribute('numbase', '2');
                } else {
                // Default Case
                    // When 3 breves left out, no modifications to perform
                    console.log("Default Case:\tNo modifications\n");
                }
            }

            else {
                // One of the possibilities when 6,9,12,etc. breves are left out, involves alteration
                // One must alter the last (uncolored) note from the middle_notes of the sequence
                last_middle_note = middle_notes[middle_notes.length - 1];
                // If the last note is uncolored, it is a candidate for alteration (given that it is a note and not a rest, and that it is a breve and not a smaller value)
                last_uncolored_note = last_middle_note;
                // But if it is colored, we need to find the last "uncolored" note, as this is the one that would be altered
                while (last_uncolored_note.hasAttribute('colored')) {
                    last_uncolored_note = get_preceding_noterest(last_uncolored_note);
                }

                if ((start_note != null && start_note.tagName == 'note' && start_note.getAttribute('dur') == long_note && !(has_been_modified(start_note)) && !(followed_by_dot(start_note))) && (last_uncolored_note.tagName == 'note' && last_uncolored_note.getAttribute('dur') == short_note && !(has_been_modified(last_uncolored_note)))) {
                // Default Case:
                    console.log("Default Case:\tImperfection a.p.p. & Alteration\n");
                    // Imperfection a.p.p.
                    start_note.setAttribute('dur.quality', 'imperfecta');
                    start_note.setAttribute('num', '3');
                    start_note.setAttribute('numbase', '2');
                    // Alteration
                    last_uncolored_note.setAttribute('dur.quality', 'altera');
                    last_uncolored_note.setAttribute('num', '1');
                    last_uncolored_note.setAttribute('numbase', '2');
                }
                else {// Exception Case:
                    console.log("Alternative Case:  No modifications\n");
                    // Start note remains perfect
                }
            } break;
    }
}

// Modification functions at the breve-semibreve level:
function modification_semibreve_level(middle_notes, tempus) {
    if (tempus == 2) {
        two_semibreves_per_breve(middle_notes);
    } else if (tempus == 3) {
        three_semibreves_per_breve(middle_notes);
    }
}

function two_semibreves_per_breve(middle_notes) {
    var note;

    switch(middle_notes.length) {

        case 1: // If there is 1 semibreve:
            // Mistake: this shouldn't happen in Ars antiqua
            console.log("MISTAKE: 1 semibreve standing alone (this is not proper of Ars antiqua)");
            break;

        case 2: // If there are 2 semibreves:
            //console.log("Semibreve interpretation: two equal semibreves");
            break;

        default: // For more than two semibreves:
            for (note of middle_notes) {
                note.setAttribute('num', middle_notes.length);
                note.setAttribute('numbase', '2');
            } //console.log("Semibreve interpretation: " + middle_notes.length + " in the place of 2");
    }
}

function three_semibreves_per_breve(middle_notes) {
    var note, note1, note2;

    switch(middle_notes.length) {

        case 1: // If there is 1 semibreve:
            // Mistake: this shouldn't happen in Ars antiqua
            console.log("MISTAKE: 1 semibreve standing alone (this is not proper of Ars antiqua)");
            break;

        case 2: // If there are 2 semibreves:
            note1 = middle_notes[0];
            note2 = middle_notes[1];
            if (note1.hasAttribute('stem.dir') && note1.getAttribute('stem.dir') == 'down') {
            // If the first note has a downward stem, we have a major-minor pair of semibreves
                note1.setAttribute('dur.quality', 'maior');
                note1.setAttribute('num', '1');
                note1.setAttribute('numbase', '2');
                note2.setAttribute('dur.quality', 'minor');
                //console.log("Semibreve interpretation: major-minor pair");
            } else {
            // On the other hand, if there is no additional markings, we have a minor-major pair of semibreves (default case)
                note1.setAttribute('dur.quality', 'minor');
                note2.setAttribute('dur.quality', 'maior');
                note2.setAttribute('num', '1');
                note2.setAttribute('numbase', '2');
                //console.log("Semibreve interpretation: minor-major pair");
            } break;

        case 3: // If there are 3 semibreves:
            // All of them are minor (1/3 of breve)
            for (note of middle_notes) {
                note.setAttribute('dur.quality', 'minor');
            } //console.log("Semibreve interpretation: three minor semibreves");
            break;

        default: // For more than three semibreves:
            for (note of middle_notes) {
                note.setAttribute('num', middle_notes.length);
                note.setAttribute('numbase', '3');
            } //console.log("Semibreve interpretation: " + middle_notes.length + " in the place of 3");
    }
}

// Post-processing functions
function replace_maximas_by_duplexlongas(meiDoc){
    const notes = Array.from(meiDoc.getElementsByTagName('note'));
    for (var note of notes) {
        if (note.getAttribute('dur') == 'maxima') {
            // Turn maximas into duplex longas
            note.setAttribute('dur', 'longa');
            note.setAttribute('dur.quality', 'duplex');
            // Use (for now) the num and numbase attributes to make the longa 'duplex'
            note.setAttribute('num', '1');
            note.setAttribute('numbase', '2');
        }
    }
}

// Main function
const lining_up = quasiscore_mensural_doc => {
    // For each voice (staff element) in the "score"
    var staves = quasiscore_mensural_doc.getElementsByTagName('staff');
    var stavesDef = quasiscore_mensural_doc.getElementsByTagName('staffDef');
    for (var i = 0; i < stavesDef.length; i++){
        console.log('\nVoice # ' + (i + 1) + ' results:\n');
        var staffDef_mensur = stavesDef[i].getElementsByTagName('mensur')[0];
        var staff = staves[i];

        // Getting the mensuration information of the voice (prolatio is irrelevant in Ars antiqua)
        var tempus = staffDef_mensur.getAttribute('tempus');
        var modusminor = staffDef_mensur.getAttribute('modusminor');

        // If there is no @tempus attribute in the <staffDef>, give the variable tempus a default value of 3.
        // The missing @tempus attribute in a voice represents the lack of semibreves that voice.
        // Therefore, the default value of the variable tempus can be either 2 or 3 (here I decided on 3).
        if (tempus == null){tempus = 3;}

        // Individual note values and gains, according to the mensuration
        var note_durs = ['semibrevis', 'brevis', 'longa'];
        var undotted_note_gain = [1, 1*tempus, modusminor * tempus];
        console.log(note_durs);
        console.log(undotted_note_gain);
        console.log();

        // Getting all the relevant elements of a staff into an array (in order of appearance).
        // The relevant elements (for Ars antiqua) are notes, rests, dots, and other group markings (such as ligatures).
        // Dots and ligatures are useful for marking the division of groups of semibreves equivalent to a breve.
        // The array allows to retrieve the index, which is not possible with MEI lists.
        var voice_content = staff.getElementsByTagName('layer')[0].children;
        var voice_noterest_dots_content = [];
        for (var element of voice_content){
            var name = element.tagName;
            if (name == 'note' || name == 'rest') {
                voice_noterest_dots_content.push(element);
            } else if (name == 'dot') {
                voice_noterest_dots_content.push(element);
                // Also encode the dot's functionality (i.e., division)
                element.setAttribute('form', 'div');
            } else if (name == 'ligature') {
                //console.log("Got a ligature!");
                // The Group_Begin and Group_End elements introduced here are just place holders, a way to indicate that the
                // set of notes between these two elements belong to the same grouping
                //(Maybe I can use just a new element <dot> for that? These elments are not getting exported to the output file, so it should be fine.)
                voice_noterest_dots_content.push(quasiscore_mensural_doc.createElementNS('http://www.music-encoding.org/ns/mei', 'Group_Begin'));
                for (var child of element.children){
                    if (child.tagName == 'note' || child.tagName == 'rest') {
                        voice_noterest_dots_content.push(child);
                    } else if (child.tagName == 'choice') {
                        // the relevant <note> and <rest> elements can be contained
                        // within a <corr> element within a <ligature> due to editorial
                        // corrections of parts of the ligature
                        var corr = child.getElementsByTagName('corr')[0];
                        for (var greatgrandchild of corr.children) {
                            if (greatgrandchild.tagName == 'note' || greatgrandchild.tagName == 'rest') {
                                voice_noterest_dots_content.push(greatgrandchild);
                            } else {
                                console.log("This child of corr (within the choice tag in a ligature) is not a note/rest:");
                                console.log(greatgrandchild);
                                console.log("It is a " + greatgrandchild.tagName);
                            }
                        }
                    } else {
                        console.log("This child of ligature is not a note/rest/choice:");
                        console.log(child);
                        console.log("It is a " + child.tagName);
                    }
                }
                voice_noterest_dots_content.push(quasiscore_mensural_doc.createElementNS('http://www.music-encoding.org/ns/mei', 'Group_End'));
            } else if (name == 'choice'){
                // The relevant <note>, <rest>, and <dot> elements can be contained
                // within a <corr> element due to editorial corrections
                var corr = element.getElementsByTagName('corr')[0];
                for (var child of corr.children) {
                    if (child.tagName == 'note' || child.tagName == 'rest') {
                        voice_noterest_dots_content.push(child);
                    } else if (child.tagName == 'dot') {
                        voice_noterest_dots_content.push(child);
                        // Also encode the dot's functionality (i.e., division)
                        child.setAttribute('form', 'div');
                    } else {
                        console.log("This child of corr is not a note/rest/dot:");
                        console.log(child);
                        console.log("It is a " + child.tagName);
                    }
                }
            } else {
                console.log("Unexpected tagnme : " + name + "\n(not a note, rest, dot, ligature, or choice)\n");
            }
        }
        /*for (var member of voice_noterest_dots_content) {
            var member_attrib = member.getAttribute('dur') + "_" + member.getAttribute('pname') + member.getAttribute('oct');
            if (member_attrib == 'null_nullnull') {
                member_attrib = '';
            } else if (member_attrib.slice(member_attrib.length-9, member_attrib.length) == '_nullnull') {
                member_attrib = member_attrib.slice(0, member_attrib.length-9);
            } console.log(member.tagName + ' ' + member_attrib);
        }console.log();*/

        // Find indices for starting and ending points of each sequence of notes to be analyzed.
        var list_of_indices_geq_B_and_dots = []; // list of indices of notes greater or equal to the Breve and the indices of group markings (these are, dots of division and beginning and ending of ligatures)
        var list_of_indices_geq_L = []; // list of indices of notes greater or equal to the long (in Ars antiqua, these are just longs---there are no maximas)
        // Get the indices
        for (var noterest of voice_noterest_dots_content) {
            if (noterest.tagName == 'dot' || noterest.tagName == 'Group_Begin' || noterest.tagName == 'Group_End' || noterest.getAttribute('dur') == 'brevis'){
                list_of_indices_geq_B_and_dots.push(voice_noterest_dots_content.indexOf(noterest));
            } else if (noterest.getAttribute('dur') == 'longa' || noterest.getAttribute('dur') == 'maxima') {
                list_of_indices_geq_B_and_dots.push(voice_noterest_dots_content.indexOf(noterest));
                list_of_indices_geq_L.push(voice_noterest_dots_content.indexOf(noterest));
            }
        }

        var o, f, start_note, end_note, middle_notes, following_note;

        // PROCESSING OF SEMIBREVES (REGARDLESS OF THE @TEMPUS)
        // SEQUENCES OF SEMIBREVES DELIMITED BY BREVES (OR HIGHER NOTE VALUES)

        //console.log("\nBREVE GEQ");
        //console.log(list_of_indices_geq_B_and_dots + "\n");
        if (!(list_of_indices_geq_B_and_dots.includes(0)) && list_of_indices_geq_B_and_dots.length != 0) {
            f = list_of_indices_geq_B_and_dots[0];
            middle_notes = voice_noterest_dots_content.slice(0,f);
            /*//DEBUG:
            var m = "";
            for (var midnote of middle_notes){
                m += midnote.getAttribute('pname') + midnote.getAttribute('oct') + " " + midnote.getAttribute('dur') + ", ";
            } console.log("\nDelimited Sequence of Semibreves: null, " + m + "null");*/
            modification_semibreve_level(middle_notes, tempus);
        }

        for (var j = 0; j < list_of_indices_geq_B_and_dots.length-1; j++) {
            // Define the sequence of notes
            o = list_of_indices_geq_B_and_dots[j];
            f = list_of_indices_geq_B_and_dots[j+1];
            middle_notes = voice_noterest_dots_content.slice(o+1,f);
            /*//DEBUG:
            var m = "";
            for (var midnote of middle_notes){
                m += midnote.getAttribute('pname') + midnote.getAttribute('oct') + " " + midnote.getAttribute('dur') + ", ";
            } console.log("\nDelimited Sequence of Semibreves: null, " + m + "null");*/
            modification_semibreve_level(middle_notes, tempus);
        }


        // PROCESSING OF BREVES AND LONGS (REGARDLESS OF THE @MODUSMINOR)
        // SEQUENCES OF BREVES DELIMITED BY LONGS (OR HIGHER NOTE VALUES)

        //console.log("\nLONGA GEQ");
        //console.log(list_of_indices_geq_L + "\n");

        // Empty list (no 'longas' or 'maximas' at all in the voice)
        if(list_of_indices_geq_L.length == 0) {
            // Define the sequence of notes
            start_note = null;
            end_note = null;
            middle_notes = voice_noterest_dots_content.slice(0, voice_noterest_dots_content.length);

            //DEBUG:
            var s = null;
            var e = null;
            var m = "";
            for (var midnote of middle_notes){
                var attribs = midnote.getAttribute('pname') + midnote.getAttribute('oct') + " " + midnote.getAttribute('dur');
                if (attribs == '0 null'){
                    m += midnote.tagName + ", ";
                } else {
                    m += attribs + ", ";
                }
            } console.log("Delimited Sequence of Breves: " + s + ", " + m + e);
            
            breves_between_longas(start_note, middle_notes, end_note, following_note, tempus, note_durs, undotted_note_gain, modusminor);
        }

        // At least one long or maxima:
        else {

            if (!(list_of_indices_geq_L.includes(0))) {
                start_note = null;
                f = list_of_indices_geq_L[0];
                end_note = voice_noterest_dots_content[f];
                try {
                    following_note = voice_noterest_dots_content[f+1];
                } catch(err) {
                    following_note = null;
                }
                middle_notes = voice_noterest_dots_content.slice(0,f);
                //DEBUG:
                var s = null;
                var e = end_note.getAttribute('pname') + end_note.getAttribute('oct') + " " + end_note.getAttribute('dur');
                var m = "";
                for (var midnote of middle_notes){
                    var attribs = midnote.getAttribute('pname') + midnote.getAttribute('oct') + " " + midnote.getAttribute('dur');
                    if (attribs == '0 null'){
                        m += midnote.tagName + ", ";
                    } else {
                        m += attribs + ", ";
                    }
                } console.log("Delimited Sequence of Breves: " + s + ", " + m + e);
                breves_between_longas(start_note, middle_notes, end_note, following_note, tempus, note_durs, undotted_note_gain, modusminor);
            }

            for (var j = 0; j < list_of_indices_geq_L.length-1; j++) {
                // Define the sequence of notes
                o = list_of_indices_geq_L[j];
                start_note = voice_noterest_dots_content[o];
                f = list_of_indices_geq_L[j+1];
                end_note = voice_noterest_dots_content[f];
                try {
                    following_note = voice_noterest_dots_content[f+1];
                } catch(err) {
                    following_note = null;
                }
                middle_notes = voice_noterest_dots_content.slice(o+1,f);
                //DEBUG:
                var s = start_note.getAttribute('pname') + start_note.getAttribute('oct') + " " + start_note.getAttribute('dur');
                var e = end_note.getAttribute('pname') + end_note.getAttribute('oct') + " " + end_note.getAttribute('dur');
                var m = "";
                for (var midnote of middle_notes){
                    var attribs = midnote.getAttribute('pname') + midnote.getAttribute('oct') + " " + midnote.getAttribute('dur');
                    if (attribs == '0 null'){
                        m += midnote.tagName + ", ";
                    } else {
                        m += attribs + ", ";
                    }
                } console.log("Delimited Sequence of Breves: " + s + ", " + m + e);
                breves_between_longas(start_note, middle_notes, end_note, following_note, tempus, note_durs, undotted_note_gain, modusminor);
            }

            // If the last note on the voice_noterest_dots_content isn't a longa (or maxima):
            var index_last_noterest = voice_noterest_dots_content.length - 1;
            if (!(list_of_indices_geq_L.includes(index_last_noterest))) {
                o = list_of_indices_geq_L[list_of_indices_geq_L.length - 1];
                start_note = voice_noterest_dots_content[o];
                end_note = null;
                following_note = null;
                middle_notes = voice_noterest_dots_content.slice(o+1,index_last_noterest+1);
                //DEBUG:
                var s = start_note.getAttribute('pname') + start_note.getAttribute('oct') + " " + start_note.getAttribute('dur');
                var e = null;
                var m = "";
                for (var midnote of middle_notes){
                    var attribs = midnote.getAttribute('pname') + midnote.getAttribute('oct') + " " + midnote.getAttribute('dur');
                    if (attribs == '0 null'){
                        m += midnote.tagName + ", ";
                    } else {
                        m += attribs + ", ";
                    }
                } console.log("Delimited Sequence of Breves: " + s + ", " + m + e);
                breves_between_longas(start_note, middle_notes, end_note, following_note, tempus, note_durs, undotted_note_gain, modusminor);
            }
        }

    }

    replace_maximas_by_duplexlongas(quasiscore_mensural_doc);

    return quasiscore_mensural_doc;
};

exports.lining_up = lining_up;

  };
  defs["./postprocessing.js"] = function (module, exports, require) { const console = quiet;
/*
    OPTIONAL POST-PROCESSING

    Post-processing functions (to be selected by the user), including:
    A) Change to modern clefs
    B) Barring of the piece with dotted barlines using a user-selected note value
*/


// A) Clef-related functions: mensural_to_modern_clefs

function mensural_to_modern_clefs(meiDoc) {
    const stavesDef = Array.from(meiDoc.getElementsByTagName('staffDef'));
    // Change clefs on each <staffDef> element
    for (var staffDef of stavesDef){
        // Retrieve the mensural clef
        var mens_clef = staffDef.getAttribute('clef.shape') + staffDef.getAttribute('clef.line');
        var cmn_clefShape, cmn_clefLine, cmn_clefDis, cmn_clefDisPlace;
        // Based on the values of the mensural clef,
        // determine and encode the attributes for the CMN clef
        switch(mens_clef) {
            case 'C1':
                staffDef.setAttribute('clef.shape', 'G');
                staffDef.setAttribute('clef.line', '2');
                break;
            case 'C2':
                staffDef.setAttribute('clef.shape', 'G');
                staffDef.setAttribute('clef.line', '2');
                break;
            case 'C3':
                staffDef.setAttribute('clef.shape', 'G');
                staffDef.setAttribute('clef.line', '2');
                staffDef.setAttribute('clef.dis', '8');
                staffDef.setAttribute('clef.dis.place', 'below');
                break;
            case 'C4':
                staffDef.setAttribute('clef.shape', 'G');
                staffDef.setAttribute('clef.line', '2');
                staffDef.setAttribute('clef.dis', '8');
                staffDef.setAttribute('clef.dis.place', 'below');
                break;
            case 'C5':
                staffDef.setAttribute('clef.shape', 'G');
                staffDef.setAttribute('clef.line', '2');
                staffDef.setAttribute('clef.dis', '8');
                staffDef.setAttribute('clef.dis.place', 'below');
                break;
            case 'F1':
                staffDef.setAttribute('clef.shape', 'G');
                staffDef.setAttribute('clef.line', '2');
                staffDef.setAttribute('clef.dis', '8');
                staffDef.setAttribute('clef.dis.place', 'below');
                break;
            case 'F2':
                staffDef.setAttribute('clef.shape', 'G');
                staffDef.setAttribute('clef.line', '2');
                staffDef.setAttribute('clef.dis', '8');
                staffDef.setAttribute('clef.dis.place', 'below');
                break;
            case 'F3':
                staffDef.setAttribute('clef.shape', 'G');
                staffDef.setAttribute('clef.line', '2');
                staffDef.setAttribute('clef.dis', '8');
                staffDef.setAttribute('clef.dis.place', 'below');
                break;
            case 'F4':
                staffDef.setAttribute('clef.shape', 'F');
                staffDef.setAttribute('clef.line', '4');
                break;
            case 'F5':
                staffDef.setAttribute('clef.shape', 'F');
                staffDef.setAttribute('clef.line', '4');
                break;
        }
    }
    // Remove all <clef> elements
    //(they represent a change in clef in the original source)
    const cleves = Array.from(meiDoc.getElementsByTagName('clef'));
    for (var clef of cleves) {
        var parent = clef.parentElement;
        parent.removeChild(clef);
    }
}


// B) Barring-related functions: add_sb_value & add_barlines (and its auxiliary function 'insert_after')

function add_sb_value(meiDoc) {
    // Retrieve all the voices (<staff> elements) and their metadata (<staffDef>)
    var staves = meiDoc.getElementsByTagName('staff');
    var stavesDef = meiDoc.getElementsByTagName('staffDef');

    // For each voice in the "score"
    for (var i = 0; i < stavesDef.length; i++){
        var staffDef_mensur = stavesDef[i].getElementsByTagName('mensur')[0];
        var staff = staves[i];

        // 1. Get the mensuration of the voice (prolatio is irrelevant in Ars antiqua)
        var modusminor = staffDef_mensur.getAttribute('modusminor');
        var tempus = staffDef_mensur.getAttribute('tempus');
        var prolatio = staffDef_mensur.getAttribute('prolatio');
        // If there is no @tempus attribute in the <staffDef>, give the variable tempus a default value of 3.
        // The missing @tempus attribute in a voice represents the lack of semibreves that voice.
        // Therefore, the default value of the variable tempus can be either 2 or 3 (here I decided on 3).
        if (tempus == null){tempus = 3;}
        // Same with @prolatio
        if (prolatio == null){prolatio = 3;}

        // 2. Determine the value (in minims) of each note/rest in the voice. This
        // value is based on the mensuration and the @dur and @dur.quality attributes
        // of the note/rest. The value is encoded temporary as an attribute (@sb_value).
        var staffNoteRests = Array.from(staff.getElementsByTagName('note')).concat(Array.from(staff.getElementsByTagName('rest')));
        var noteValue;
        for (var noterest of staffNoteRests) {
            switch(noterest.getAttribute('dur')) {

                case 'longa':
                    noteValue = modusminor * tempus * prolatio;
                    if (noterest.hasAttribute('dur.quality')) {
                        switch (noterest.getAttribute('dur.quality')){
                            // regular values
                            case 'perfecta':
                                noteValue = 3 * tempus * prolatio;
                                break;
                            case 'imperfecta':
                                noteValue = 2 * tempus * prolatio;
                                break;
                            // twice as long
                            case 'duplex':
                                noteValue = 2 * noteValue;
                        }
                    } else if (noterest.hasAttribute('num') && noterest.hasAttribute('numbase')) {
                        // special case of partial imperfection
                        noteValue = noteValue * noterest.getAttribute('numbase') / noterest.getAttribute('num');
                    }break;

                case 'brevis':
                    noteValue = tempus * prolatio;
                    if (noterest.hasAttribute('dur.quality')) {
                        switch (noterest.getAttribute('dur.quality')){
                            // regular values
                            case 'perfecta':
                                noteValue = 3 * prolatio;
                                break;
                            case 'imperfecta':
                                noteValue = 2 * prolatio;
                                break;
                            // twice as long
                            case 'altera':
                                noteValue = 2 * noteValue;
                        }
                    } else if (noterest.hasAttribute('num') && noterest.hasAttribute('numbase')) {
                        // special case of partial imperfection
                        noteValue = noteValue * noterest.getAttribute('numbase') / noterest.getAttribute('num');
                    }break;

                case 'semibrevis':
                    noteValue =  prolatio;
                    if (noterest.hasAttribute('dur.quality')) {
                        switch (noterest.getAttribute('dur.quality')){
                            // regular
                            case 'minor': // Ars antiqua
                                noteValue = prolatio;
                                break;
                            case 'perfecta': // Ars nova & white mensural
                                noteValue = 3;
                                break;
                            case 'imperfecta': // Ars nova & white mensural
                                noteValue = 2;
                                break;
                            // twice as long
                            case 'maior': // Ars antiqua
                                noteValue = 2 * noteValue;
                                break;
                            case 'altera': // Ars nova & white mensural
                                noteValue = 2 * noteValue;
                                break;
                        }
                    } else if (noterest.hasAttribute('num') && noterest.hasAttribute('numbase')) {
                        // special cases of Ars antiqua semibreves (more than 2 or 3 per breve)
                        noteValue = noteValue * noterest.getAttribute('numbase') / noterest.getAttribute('num');
                    }break;

                case 'minima':
                    noteValue = 1;
                    if (noterest.hasAttribute('dur.quality')) {
                        switch (noterest.getAttribute('dur.quality')){
                            // regular values
                            case 'perfecta':
                                noteValue = 1.5;
                                break;
                            case 'imperfecta':
                                noteValue = 1;
                                break;
                            // twice as long
                            case 'altera':
                                noteValue = 2 * noteValue;
                                break;
                        }
                    } else if (noterest.hasAttribute('num') && noterest.hasAttribute('numbase')) {
                        // in case num & numbase is used as an alternative to the 'perfecta' / 'imperfecta' quality
                        noteValue = noteValue * noterest.getAttribute('numbase') / noterest.getAttribute('num');
                    }break;

                case 'semiminima':
                    noteValue = 0.5;
                    if (noterest.hasAttribute('dur.quality')) {
                        switch (noterest.getAttribute('dur.quality')){
                            // regular values
                            case 'perfecta':
                                noteValue = 0.75;
                                break;
                            case 'imperfecta':
                                noteValue = 0.5;
                                break;
                        }
                    } else if (noterest.hasAttribute('num') && noterest.hasAttribute('numbase')) {
                        // in case num & numbase is used as an alternative to the 'perfecta' / 'imperfecta' quality
                        noteValue = noteValue * noterest.getAttribute('numbase') / noterest.getAttribute('num');
                    }break;

                case 'fusa':
                    noteValue = 0.25;
                    if (noterest.hasAttribute('dur.quality')) {
                        switch (noterest.getAttribute('dur.quality')){
                            // regular values
                            case 'perfecta':
                                noteValue = 0.375;
                                break;
                            case 'imperfecta':
                                noteValue = 0.25;
                                break;
                        }
                    } else if (noterest.hasAttribute('num') && noterest.hasAttribute('numbase')) {
                        // in case num & numbase is used as an alternative to the 'perfecta' / 'imperfecta' quality
                        noteValue = noteValue * noterest.getAttribute('numbase') / noterest.getAttribute('num');
                    }break;

                case 'semifusa':
                    noteValue = 0.125;
                    if (noterest.hasAttribute('dur.quality')) {
                        switch (noterest.getAttribute('dur.quality')){
                            // regular values
                            case 'imperfecta':
                                noteValue = 0.125;
                                break;
                        }
                    } else if (noterest.hasAttribute('num') && noterest.hasAttribute('numbase')) {
                        // in case num & numbase is used as an alternative to the 'perfecta' / 'imperfecta' quality
                        noteValue = noteValue * noterest.getAttribute('numbase') / noterest.getAttribute('num');
                    }break;

            }noterest.setAttribute('sb_value', ''+(noteValue/prolatio));
        }
    }
}

function insert_after(new_element, some_element) {
    // Inserts the new_element after the some_element
    // A) either as its next sibling by using parent.insertBefore(next_element, nextsibling)
    // or parent.appendChild(new_element), depending on the position of the some_element
    // B) or the next sibling of its parent in case we are at the end of a 'corr' element
    var nextsibling = some_element.nextElementSibling;
    var parent = some_element.parentElement;
    var choice_element;
    if (nextsibling == null) {
        // If there is no following sibling, then we are at the last child
        // Therefore, we append the new_element at the end (see 'else')
        // except if we are inside a 'corr' element, then we insert it after its 'choice' parent
        if (parent.tagName == "corr") {
            choice_element = parent.parentElement;
            insert_after(new_element, choice_element);
        } else {
            parent.appendChild(new_element);
        }
    } else {
        // If there is a following sibling, we insert the new_element before it (see 'else')
        // except if there is a dot, then we insert the new_element after the dot
        if (nextsibling.tagName == "dot") {
            insert_after(new_element, nextsibling);
        } else {
            parent.insertBefore(new_element, nextsibling);
        }
    }
}

function add_barlines(meiDoc, bar_by_note){
    var corr, child, grandchild, greatgrandchild;
    // Retrieve all the voices (<staff> elements) and their metadata (<staffDef>)
    var staves = meiDoc.getElementsByTagName('staff');
    var stavesDef = meiDoc.getElementsByTagName('staffDef');
    // For each voice in the "score"
    for (var i = 0; i < stavesDef.length; i++){
        // Get the corresponding <staff> and <staffDef> elements
        // (or, more precisely, the <mensur> element within <staffDef>)
        var staffDef_mensur = stavesDef[i].getElementsByTagName('mensur')[0];
        var staff = staves[i];
        // Obtain the ORDERED sequence of notes and rests within that voice
        var staff_layer = staff.children[0];
        var seqNotesAndRests = Array.from([]);
        for (var element of staff_layer.children) {
            switch(element.tagName) {
                case 'note':
                    seqNotesAndRests.push(element);
                    break;
                case 'rest':
                    seqNotesAndRests.push(element);
                    break;
                case 'ligature':
                    for (child of element.children) {
                        switch(child.tagName) {
                            case 'note':
                                seqNotesAndRests.push(child);
                                break;
                            case 'rest':
                                seqNotesAndRests.push(child);
                                break;
                            case 'choice':
                                corr = child.getElementsByTagName('corr')[0];
                                for (greatgrandchild of corr.children) {
                                    switch(greatgrandchild.tagName) {
                                        case 'note':
                                            seqNotesAndRests.push(greatgrandchild);
                                            break;
                                        case 'rest':
                                            seqNotesAndRests.push(greatgrandchild);
                                            break;
                                    }
                                    
                                }
                        }
                    }break;
                case 'choice':
                    corr = element.getElementsByTagName('corr')[0];
                    for (grandchild of corr.children) {
                        switch(grandchild.tagName) {
                            case 'note':
                                seqNotesAndRests.push(grandchild);
                                break;
                            case 'rest':
                                seqNotesAndRests.push(grandchild);
                                break;
                        }
                    }break;

            }
        }
        // Determine the locations were barlines can be added
        // This is, where the note offset coincides with the bar-length
        // 1. Define the bar-length to be the length of a longa (in semibreves)
        var barLength_Sb;
        var modusminor = staffDef_mensur.getAttribute('modusminor');
        var tempus = staffDef_mensur.getAttribute('tempus');
        var prolatio = staffDef_mensur.getAttribute('prolatio');
        if (tempus == null){tempus = 3;}
        if (prolatio == null){prolatio = 3;}
        switch(bar_by_note) {
            case "semibrevis":
                barLength_Sb = 1;
                break;
            case "brevis":
                barLength_Sb = tempus;
                break;
            case "longa":
                barLength_Sb = modusminor * tempus;
                break;
        }console.log('\nVoice # ' + (i + 1) + ': bar-length = ' + barLength_Sb + ' Sb');
        // 2. Add the barlines where the accumulated value of the notes (in semibreves,
        // as can be found using the @sb_value added in the 'add_sb_value' function) is
        // equal to the bar-length.
        var accum = 0;
        for (var noterest of seqNotesAndRests) {
            accum += parseFloat(noterest.getAttribute('sb_value'));
            console.log(noterest.tagName + ' ' + noterest.getAttribute('dur') + ' ' + noterest.getAttribute('sb_value'));
            console.log(accum);
            // The condition should be accum % barLength_Sb == 0,
            // but because JavaScript doesn't sum periodic decimals correctly
            // we are substitutin the original condition by checking that
            // the division by the barlength provides a number close to an integer
            if (Math.abs((accum / barLength_Sb) - Math.round(accum / barLength_Sb)) < 0.00001){
                // Create dotted <barLine> element
                var barline = meiDoc.createElementNS('http://www.music-encoding.org/ns/mei', 'barLine');
                barline.setAttribute('form', 'dashed');
                // Insert the new <barLine> element after the noterest
                insert_after(barline, noterest);
                console.log('---- barline ----');
            }
        }
    }
}

/*
    Refine Score: User selection of the post-processing methods
    (switch to modern clefs and barring of the piece)
    to improve readibility for modern musicians
*/
const refine_score = (scoreDoc, switch_to_modern_clefs_flag, bar_by_note_value) => {
    if (switch_to_modern_clefs_flag) {
        mensural_to_modern_clefs(scoreDoc);
    }// else, we stay with the original (mensural) clefs of the parts MEI file
    switch(bar_by_note_value) {
        case "None":
            break;
        default:
            // Calculate the values of all notes in semibreves (add_sb_value)
            // to determine the place where barlines should be added (add_barlines)
            add_sb_value(scoreDoc);
            add_barlines(scoreDoc, bar_by_note_value);
            // Remove the 'sb_value' attribute for producing a valid file
            for (var note of scoreDoc.getElementsByTagName('note')) {
                note.removeAttribute('sb_value');
            }
            for (var rest of scoreDoc.getElementsByTagName('rest')) {
                rest.removeAttribute('sb_value');
            }
    }
    return scoreDoc;
};

exports.refine_score = refine_score;


/*
    REQUIRED POST-PROCESSING:

    - Replace ligatures by brackets (otherwise, vertical alignment is not visible within ligatures)
    - Remove @num and @numbase attributes when @dur.quality is used (to make it MEI-compliant)
*/

const replace_ligatures_by_brackets = (meiDoc) => {
    // Replace all ligatures by <bracketSpan> elements located at the end of the <section>
    const section = meiDoc.getElementsByTagName('section')[0];
    // First, retrieve all ligatures
    const ligatures = Array.from(meiDoc.getElementsByTagName('ligature'));
    // Then, for each ligature
    for (var ligature of ligatures) {
        // 1. Take the elements contained within that <ligature>
        // and incorporate them into the stream of notes of the <layer>
        var parent = ligature.parentElement;
        var ligated_notes = Array.from(ligature.children);
        for (var element of ligated_notes) {
            parent.insertBefore(element, ligature);
        }
        // 2. And create the <bracketSpan> element to replace the ligature
        var bracketSpan = meiDoc.createElementNS('http://www.music-encoding.org/ns/mei', 'bracketSpan');
        bracketSpan.setAttribute('xml:id', ligature.getAttribute('xml:id'));
        // With @startid and @endid pointing to the start and end of the ligature
        var start_note = ligated_notes[0];
        if (start_note.tagName == 'choice') {
            start_note = start_note.getElementsByTagName('corr')[0].children[0];
        }
        var end_note = ligated_notes[ligated_notes.length - 1];
        if (end_note.tagName == 'choice') {
            var corr_children = end_note.getElementsByTagName('corr')[0].children;
            end_note = corr_children[corr_children.length - 1];
        }
        bracketSpan.setAttribute('startid', '#' + start_note.getAttribute('xml:id'));
        bracketSpan.setAttribute('endid', '#' + end_note.getAttribute('xml:id'));
        // And with attributes corresponding to a mensural ligature
        bracketSpan.setAttribute('func', 'ligature');
        bracketSpan.setAttribute('lform', 'solid');
        // 3. Remove the ligature
        parent.removeChild(ligature);
        // 4. Add the <bracketSpan> to the end of <section>
        section.appendChild(bracketSpan);
    }
};

const remove_num_and_numbase = (meiDoc) => {
    // Remove the attributes @num and @numbase when a @dur.quality attribute is presesnt
    const notes = meiDoc.getElementsByTagName('note');
    for (var note of notes) {
        if (note.hasAttribute('dur.quality')) {
            note.removeAttribute('num');
            note.removeAttribute('numbase');
        }
    }
};

exports.replace_ligatures_by_brackets = replace_ligatures_by_brackets;
exports.remove_num_and_numbase = remove_num_and_numbase;

  };
  const Merge = require('./Merge.js'), ArsNova = require('./ArsNova_and_WhiteMensural.js'), ArsAntiqua = require('./ArsAntiqua.js'), PostProcessing = require('./postprocessing.js');
  global.ScoringUp = { merge: Merge.merge, ArsNova, ArsAntiqua, PostProcessing };
})(typeof window !== 'undefined' ? window : globalThis);
