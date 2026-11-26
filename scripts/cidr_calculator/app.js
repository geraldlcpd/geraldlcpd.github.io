(function (global) {
  'use strict';

  function parseIpv4(ipStr) {
    const trimmed = String(ipStr).trim();
    const parts = trimmed.split('.');
    if (parts.length !== 4) {
      throw new Error('Invalid IPv4 address: ' + ipStr);
    }
    let num = 0;
    for (let i = 0; i < 4; i++) {
      if (!/^\d+$/.test(parts[i])) {
        throw new Error('Invalid IPv4 octet: ' + parts[i]);
      }
      const octet = Number(parts[i]);
      if (octet < 0 || octet > 255) {
        throw new Error('IPv4 octet out of range (0-255): ' + parts[i]);
      }
      num = (num * 256) + octet;
    }
    return num >>> 0;
  }

  function formatIpv4(num) {
    const n = num >>> 0;
    return [
      (n >>> 24) & 255,
      (n >>> 16) & 255,
      (n >>> 8) & 255,
      n & 255
    ].join('.');
  }

  function ipv4ToBinary(num) {
    const n = num >>> 0;
    return [
      ((n >>> 24) & 255).toString(2).padStart(8, '0'),
      ((n >>> 16) & 255).toString(2).padStart(8, '0'),
      ((n >>> 8) & 255).toString(2).padStart(8, '0'),
      (n & 255).toString(2).padStart(8, '0')
    ].join('.');
  }

  function prefixToMask(prefix) {
    if (prefix === 0) return 0;
    return (0xffffffff << (32 - prefix)) >>> 0;
  }

  function getIpv4Class(ipNum) {
    const first = (ipNum >>> 24) & 255;
    if (first < 128) return 'Class A';
    if (first < 192) return 'Class B';
    if (first < 224) return 'Class C';
    if (first < 240) return 'Class D (Multicast)';
    return 'Class E (Experimental)';
  }

  function getIpv4Scope(ipNum) {
    const a = (ipNum >>> 24) & 255;
    const b = (ipNum >>> 16) & 255;
    if (a === 10) return 'Private (RFC 1918)';
    if (a === 172 && b >= 16 && b <= 31) return 'Private (RFC 1918)';
    if (a === 192 && b === 168) return 'Private (RFC 1918)';
    if (a === 127) return 'Loopback (RFC 1122)';
    if (a === 169 && b === 254) return 'Link-Local (RFC 3927)';
    if (a === 100 && b >= 64 && b <= 127) return 'CGNAT / Shared (RFC 6598)';
    if (a >= 224 && a <= 239) return 'Multicast';
    if (a === 0) return 'This Network (RFC 1122)';
    return 'Public / Global';
  }

  function parseIpv4CidrParts(cidrStr) {
    const trimmed = String(cidrStr).trim();
    const slashIdx = trimmed.indexOf('/');
    if (slashIdx === -1) {
      throw new Error('CIDR must include a prefix length (e.g. 192.168.1.0/24).');
    }
    const ipPart = trimmed.slice(0, slashIdx).trim();
    const prefixPart = trimmed.slice(slashIdx + 1).trim();
    if (!/^\d+$/.test(prefixPart)) {
      throw new Error('Invalid IPv4 prefix length: ' + prefixPart);
    }
    const prefix = Number(prefixPart);
    if (prefix < 0 || prefix > 32) {
      throw new Error('IPv4 prefix length must be between 0 and 32.');
    }
    const ipNum = parseIpv4(ipPart);
    return { ipNum, prefix };
  }

  function analyzeIpv4Cidr(cidrStr) {
    const { ipNum, prefix } = parseIpv4CidrParts(cidrStr);
    const maskNum = prefixToMask(prefix);
    const wildcardNum = (~maskNum) >>> 0;
    const networkNum = (ipNum & maskNum) >>> 0;
    const broadcastNum = (networkNum | wildcardNum) >>> 0;
    const totalAddresses = Math.pow(2, 32 - prefix);

    let usableHosts;
    let firstHostNum;
    let lastHostNum;

    if (prefix === 32) {
      usableHosts = 1;
      firstHostNum = networkNum;
      lastHostNum = networkNum;
    } else if (prefix === 31) {
      // RFC 3021 point-to-point link
      usableHosts = 2;
      firstHostNum = networkNum;
      lastHostNum = broadcastNum;
    } else {
      usableHosts = Math.max(0, totalAddresses - 2);
      firstHostNum = (networkNum + 1) >>> 0;
      lastHostNum = (broadcastNum - 1) >>> 0;
    }

    return {
      version: 4,
      cidr: formatIpv4(networkNum) + '/' + prefix,
      ip: formatIpv4(ipNum),
      prefix,
      network: formatIpv4(networkNum),
      broadcast: formatIpv4(broadcastNum),
      netmask: formatIpv4(maskNum),
      wildcard: formatIpv4(wildcardNum),
      firstHost: formatIpv4(firstHostNum),
      lastHost: formatIpv4(lastHostNum),
      totalAddresses,
      usableHosts,
      ipClass: getIpv4Class(ipNum),
      scope: getIpv4Scope(networkNum),
      binaryIp: ipv4ToBinary(ipNum),
      binaryMask: ipv4ToBinary(maskNum),
      binaryNetwork: ipv4ToBinary(networkNum),
      networkNum,
      broadcastNum
    };
  }

  function splitIpv4Cidr(cidrStr, newPrefix, maxRows) {
    const limit = typeof maxRows === 'number' ? maxRows : 256;
    const base = analyzeIpv4Cidr(cidrStr);
    const target = Number(newPrefix);
    if (!Number.isInteger(target) || target < base.prefix || target > 32) {
      throw new Error(`New prefix must be between /${base.prefix} and /32.`);
    }
    const count = Math.pow(2, target - base.prefix);
    const step = Math.pow(2, 32 - target);
    const shown = Math.min(count, limit);
    const subnets = [];

    for (let i = 0; i < shown; i++) {
      const net = (base.networkNum + i * step) >>> 0;
      subnets.push(analyzeIpv4Cidr(formatIpv4(net) + '/' + target));
    }

    return {
      totalSubnets: count,
      shown,
      truncated: count > shown,
      subnets
    };
  }

  function ipInIpv4Cidr(ipStr, cidrStr) {
    const ipNum = parseIpv4(ipStr);
    const info = analyzeIpv4Cidr(cidrStr);
    return ipNum >= info.networkNum && ipNum <= info.broadcastNum;
  }

  function cidrsOverlapIpv4(cidrA, cidrB) {
    const a = analyzeIpv4Cidr(cidrA);
    const b = analyzeIpv4Cidr(cidrB);
    return a.networkNum <= b.broadcastNum && b.networkNum <= a.broadcastNum;
  }

  // IPv6 helpers (BigInt)
  function parseIpv6(ipStr) {
    let s = String(ipStr).trim();
    const zoneIdx = s.indexOf('%');
    if (zoneIdx !== -1) s = s.slice(0, zoneIdx);

    const doubleColonParts = s.split('::');
    if (doubleColonParts.length > 2) {
      throw new Error('Invalid IPv6 address (multiple "::"): ' + ipStr);
    }

    let leftGroups = [];
    let rightGroups = [];

    if (doubleColonParts.length === 2) {
      leftGroups = doubleColonParts[0] ? doubleColonParts[0].split(':') : [];
      rightGroups = doubleColonParts[1] ? doubleColonParts[1].split(':') : [];
    } else {
      leftGroups = s.split(':');
    }

    // Handle embedded IPv4 in the last group
    const expandIpv4Tail = (groups) => {
      if (groups.length > 0 && groups[groups.length - 1].includes('.')) {
        const ipv4Num = parseIpv4(groups.pop());
        groups.push(((ipv4Num >>> 16) & 0xffff).toString(16));
        groups.push((ipv4Num & 0xffff).toString(16));
      }
    };

    if (doubleColonParts.length === 2) {
      expandIpv4Tail(rightGroups);
      if (rightGroups.length === 0) expandIpv4Tail(leftGroups);
    } else {
      expandIpv4Tail(leftGroups);
    }

    const totalExplicit = leftGroups.length + rightGroups.length;
    if (doubleColonParts.length === 2) {
      if (totalExplicit > 7) {
        throw new Error('Invalid IPv6 address (too many groups): ' + ipStr);
      }
    } else if (totalExplicit !== 8) {
      throw new Error('Invalid IPv6 address (expected 8 groups): ' + ipStr);
    }

    const missing = 8 - totalExplicit;
    const allGroups = [
      ...leftGroups,
      ...Array(missing).fill('0'),
      ...rightGroups
    ];

    let result = 0n;
    for (const g of allGroups) {
      if (!/^[0-9a-fA-F]{1,4}$/.test(g)) {
        throw new Error('Invalid IPv6 hextet: ' + g);
      }
      result = (result << 16n) | BigInt(parseInt(g, 16));
    }
    return result;
  }

  function ipv6ToGroups(val) {
    const groups = [];
    for (let i = 7; i >= 0; i--) {
      groups.push(Number((val >> BigInt(i * 16)) & 0xffffn));
    }
    return groups;
  }

  function formatIpv6Expanded(val) {
    return ipv6ToGroups(val).map((g) => g.toString(16).padStart(4, '0')).join(':');
  }

  function formatIpv6Compressed(val) {
    const hex = ipv6ToGroups(val).map((g) => g.toString(16));
    let bestStart = -1;
    let bestLen = 0;
    let curStart = -1;
    let curLen = 0;

    for (let i = 0; i < 8; i++) {
      if (hex[i] === '0') {
        if (curStart === -1) curStart = i;
        curLen++;
        if (curLen > bestLen) {
          bestStart = curStart;
          bestLen = curLen;
        }
      } else {
        curStart = -1;
        curLen = 0;
      }
    }

    if (bestLen < 2) return hex.join(':');
    const left = hex.slice(0, bestStart).join(':');
    const right = hex.slice(bestStart + bestLen).join(':');
    return `${left}::${right}`;
  }

  function getIpv6Scope(val) {
    if (val === 1n) return 'Loopback (::1)';
    if (val === 0n) return 'Unspecified (::)';
    const first16 = Number((val >> 112n) & 0xffffn);
    if ((first16 & 0xfe00) === 0xfc00) return 'Unique Local (fc00::/7)';
    if ((first16 & 0xffc0) === 0xfe80) return 'Link-Local (fe80::/10)';
    if ((first16 & 0xff00) === 0xff00) return 'Multicast (ff00::/8)';
    if (first16 === 0x2001 && Number((val >> 96n) & 0xffffn) === 0x0db8) return 'Documentation (2001:db8::/32)';
    if ((first16 & 0xe000) === 0x2000) return 'Global Unicast (2000::/3)';
    return 'Reserved / Other';
  }

  function analyzeIpv6Cidr(cidrStr) {
    const trimmed = String(cidrStr).trim();
    const slashIdx = trimmed.indexOf('/');
    if (slashIdx === -1) {
      throw new Error('IPv6 CIDR must include a prefix length (e.g. 2001:db8::/32).');
    }
    const ipPart = trimmed.slice(0, slashIdx).trim();
    const prefixPart = trimmed.slice(slashIdx + 1).trim();
    if (!/^\d+$/.test(prefixPart)) {
      throw new Error('Invalid IPv6 prefix length: ' + prefixPart);
    }
    const prefix = Number(prefixPart);
    if (prefix < 0 || prefix > 128) {
      throw new Error('IPv6 prefix length must be between 0 and 128.');
    }

    const ipVal = parseIpv6(ipPart);
    const allOnes = (1n << 128n) - 1n;
    const hostBits = BigInt(128 - prefix);
    const maskVal = prefix === 0 ? 0n : (allOnes << hostBits) & allOnes;
    const networkVal = ipVal & maskVal;
    const lastVal = networkVal | (allOnes & ~maskVal);
    const totalAddresses = 1n << hostBits;

    return {
      version: 6,
      cidr: formatIpv6Compressed(networkVal) + '/' + prefix,
      ip: formatIpv6Compressed(ipVal),
      ipExpanded: formatIpv6Expanded(ipVal),
      prefix,
      network: formatIpv6Compressed(networkVal),
      networkExpanded: formatIpv6Expanded(networkVal),
      firstHost: formatIpv6Compressed(networkVal),
      lastHost: formatIpv6Compressed(lastVal),
      lastHostExpanded: formatIpv6Expanded(lastVal),
      totalAddresses: totalAddresses.toLocaleString('en-US'),
      totalAddressesRaw: totalAddresses.toString(),
      scope: getIpv6Scope(networkVal)
    };
  }

  function analyzeCidr(cidrStr) {
    const s = String(cidrStr).trim();
    if (s.includes(':')) {
      return analyzeIpv6Cidr(s);
    }
    return analyzeIpv4Cidr(s);
  }

  const api = {
    parseIpv4,
    formatIpv4,
    ipv4ToBinary,
    analyzeIpv4Cidr,
    splitIpv4Cidr,
    ipInIpv4Cidr,
    cidrsOverlapIpv4,
    parseIpv6,
    formatIpv6Expanded,
    formatIpv6Compressed,
    analyzeIpv6Cidr,
    analyzeCidr
  };

  global.CidrCalculator = api;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : window);
