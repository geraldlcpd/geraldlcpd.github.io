/**
 * Pure JavaScript MD5 Implementation (Self-Contained & Offline)
 * Supports Uint8Array / ArrayBuffer and incremental/chunked hashing.
 */
(function (global) {
  'use strict';

  function createMD5() {
    let state = new Int32Array([1732584193, -271733879, -1732584194, 271733878]);
    let buffer = new Uint8Array(64);
    let bufferLength = 0;
    let bytesHashed = 0;

    const K = new Int32Array([
      -680876936, -389564586,  606105819, -1044525330,
      -176418897,  1200080426, -1473231341, -45705983,
       1770035416, -1958414417, -42063,      -1990404162,
       1804603682, -40341101,   -1502002290,  1236535329,
      -165796510,  -1069501632,  643717713,  -373897302,
      -701558691,   38016083,   -660478335,  -405537848,
       568446438,  -1019803690, -187363961,   1163531501,
      -144468057,  -51403784,    1735328473, -1926607734,
      -378558,     -2022574463,  1839030562, -35309556,
      -1530992060,  1272893353, -155497632,  -1094730640,
       680876936,  -358537222,  -722521979,   76029189,
      -640364487,  -421815835,   530742520,  -995338651,
      -198630844,   1120210379, -1416354905, -57434055,
       1700485571, -1894980106, -1051523,    -2054922799,
       1873313359, -30611744,   -1560198380,  1309151649,
      -145523070,  -1120210379,  718787259,  -343485551
    ]);

    const S = [
      7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
      5,  9, 14, 20, 5,  9, 14, 20, 5,  9, 14, 20, 5,  9, 14, 20,
      4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
      6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21
    ];

    function md5cycle(x) {
      let a = state[0], b = state[1], c = state[2], d = state[3];

      for (let i = 0; i < 64; i++) {
        let f, g;
        if (i < 16) {
          f = (b & c) | ((~b) & d);
          g = i;
        } else if (i < 32) {
          f = (d & b) | ((~d) & c);
          g = (5 * i + 1) % 16;
        } else if (i < 48) {
          f = b ^ c ^ d;
          g = (3 * i + 5) % 16;
        } else {
          f = c ^ (b | (~d));
          g = (7 * i) % 16;
        }
        const temp = d;
        d = c;
        c = b;
        const sum = (a + f + K[i] + x[g]) | 0;
        b = (b + ((sum << S[i]) | (sum >>> (32 - S[i])))) | 0;
        a = temp;
      }

      state[0] = (state[0] + a) | 0;
      state[1] = (state[1] + b) | 0;
      state[2] = (state[2] + c) | 0;
      state[3] = (state[3] + d) | 0;
    }

    function processBlock(block) {
      const x = new Int32Array(16);
      for (let i = 0; i < 16; i++) {
        x[i] = block[i * 4] |
               (block[i * 4 + 1] << 8) |
               (block[i * 4 + 2] << 16) |
               (block[i * 4 + 3] << 24);
      }
      md5cycle(x);
    }

    return {
      append: function (data) {
        let bytes = data;
        if (data instanceof ArrayBuffer) {
          bytes = new Uint8Array(data);
        }
        let offset = 0;
        bytesHashed += bytes.length;

        while (offset < bytes.length) {
          const toCopy = Math.min(bytes.length - offset, 64 - bufferLength);
          buffer.set(bytes.subarray(offset, offset + toCopy), bufferLength);
          bufferLength += toCopy;
          offset += toCopy;

          if (bufferLength === 64) {
            processBlock(buffer);
            bufferLength = 0;
          }
        }
        return this;
      },

      finalize: function () {
        const totalBitsLow = (bytesHashed * 8) & 0xFFFFFFFF;
        const totalBitsHigh = Math.floor(bytesHashed / 0x20000000);

        const padLen = (bufferLength < 56) ? (56 - bufferLength) : (120 - bufferLength);
        const padding = new Uint8Array(padLen + 8);
        padding[0] = 0x80;

        padding[padLen]     = totalBitsLow & 0xFF;
        padding[padLen + 1] = (totalBitsLow >>> 8) & 0xFF;
        padding[padLen + 2] = (totalBitsLow >>> 16) & 0xFF;
        padding[padLen + 3] = (totalBitsLow >>> 24) & 0xFF;
        padding[padLen + 4] = totalBitsHigh & 0xFF;
        padding[padLen + 5] = (totalBitsHigh >>> 8) & 0xFF;
        padding[padLen + 6] = (totalBitsHigh >>> 16) & 0xFF;
        padding[padLen + 7] = (totalBitsHigh >>> 24) & 0xFF;

        this.append(padding);

        const hex = [];
        for (let i = 0; i < 4; i++) {
          const val = state[i];
          for (let b = 0; b < 4; b++) {
            const byte = (val >>> (b * 8)) & 0xFF;
            hex.push(byte.toString(16).padStart(2, '0'));
          }
        }
        return hex.join('');
      }
    };
  }

  global.OfflineMD5 = {
    create: createMD5,
    hashBuffer: function (buffer) {
      const md5 = createMD5();
      md5.append(buffer);
      return md5.finalize();
    }
  };
})(typeof window !== 'undefined' ? window : this);
