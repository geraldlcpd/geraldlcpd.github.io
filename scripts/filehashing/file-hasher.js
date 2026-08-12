/**
 * Offline File Hasher Logic
 * Supports chunked processing via WebCrypto API (SHA-1, SHA-256, SHA-384, SHA-512) and OfflineMD5.
 */
document.addEventListener('DOMContentLoaded', () => {
  // DOM Elements
  const dropZone = document.getElementById('dropZone');
  const fileInput = document.getElementById('fileInput');
  const browseBtn = document.getElementById('browseBtn');
  const fileDetails = document.getElementById('fileDetails');
  const fileNameEl = document.getElementById('fileName');
  const fileSizeEl = document.getElementById('fileSize');
  const fileTypeEl = document.getElementById('fileType');

  const algoSelect = document.getElementById('algoSelect');
  const startBtn = document.getElementById('startBtn');
  const cancelBtn = document.getElementById('cancelBtn');

  const progressContainer = document.getElementById('progressContainer');
  const progressBar = document.getElementById('progressBar');
  const progressText = document.getElementById('progressText');
  const speedText = document.getElementById('speedText');

  const resultsSection = document.getElementById('resultsSection');
  const hashOutput = document.getElementById('hashOutput');
  const copyHashBtn = document.getElementById('copyHashBtn');
  const caseToggleBtn = document.getElementById('caseToggleBtn');
  const timeTakenEl = document.getElementById('timeTaken');

  // Certutil section
  const certutilCmd = document.getElementById('certutilCmd');
  const psCmd = document.getElementById('psCmd');
  const copyCertutilBtn = document.getElementById('copyCertutilBtn');
  const copyPsBtn = document.getElementById('copyPsBtn');

  // Compare section
  const expectedHashInput = document.getElementById('expectedHashInput');
  const compareStatus = document.getElementById('compareStatus');

  let selectedFile = null;
  let isProcessing = false;
  let currentReader = null;
  let isUppercase = true;

  // File Drop Handlers
  dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('drag-over');
  });

  dropZone.addEventListener('dragleave', () => {
    dropZone.classList.remove('drag-over');
  });

  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('drag-over');
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFileSelect(e.dataTransfer.files[0]);
    }
  });

  browseBtn.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', (e) => {
    if (e.target.files && e.target.files.length > 0) {
      handleFileSelect(e.target.files[0]);
    }
  });

  function formatBytes(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  function handleFileSelect(file) {
    selectedFile = file;
    fileNameEl.textContent = file.name;
    fileSizeEl.textContent = formatBytes(file.size);
    fileTypeEl.textContent = file.type || 'Unknown / Binary';

    fileDetails.style.display = 'block';
    startBtn.disabled = false;
    resultsSection.style.display = 'none';
    progressContainer.style.display = 'none';

    updateCertutilCommands(file.name, algoSelect.value);
  }

  algoSelect.addEventListener('change', () => {
    if (selectedFile) {
      updateCertutilCommands(selectedFile.name, algoSelect.value);
    }
  });

  function updateCertutilCommands(filename, algo) {
    const safeName = filename.replace(/"/g, '""');
    const certAlgo = algo === 'MD5' ? 'MD5' : algo.replace('-', '');
    const psAlgo = algo === 'MD5' ? 'MD5' : algo.replace('-', '');

    certutilCmd.textContent = `certutil -hashfile "${safeName}" ${certAlgo}`;
    psCmd.textContent = `Get-FileHash -Path "${safeName}" -Algorithm ${psAlgo}`;
  }

  startBtn.addEventListener('click', () => {
    if (selectedFile && !isProcessing) {
      computeHash(selectedFile, algoSelect.value);
    }
  });

  cancelBtn.addEventListener('click', () => {
    if (currentReader) {
      currentReader.abort();
    }
    isProcessing = false;
    startBtn.style.display = 'inline-flex';
    cancelBtn.style.display = 'none';
    progressContainer.style.display = 'none';
  });

  async function computeHash(file, algo) {
    isProcessing = true;
    startBtn.style.display = 'none';
    cancelBtn.style.display = 'inline-flex';
    progressContainer.style.display = 'block';
    resultsSection.style.display = 'none';
    progressBar.style.width = '0%';
    progressText.textContent = '0%';
    speedText.textContent = 'Preparing...';

    const startTime = performance.now();
    const CHUNK_SIZE = 4 * 1024 * 1024; // 4MB chunks
    const totalSize = file.size;
    let offset = 0;

    try {
      let finalHex = '';

      if (algo === 'MD5') {
        const md5Instance = window.OfflineMD5.create();
        let lastReportTime = startTime;
        let bytesSinceReport = 0;

        while (offset < totalSize && isProcessing) {
          const chunk = await readSlice(file, offset, offset + CHUNK_SIZE);
          md5Instance.append(chunk);

          offset += chunk.byteLength;
          bytesSinceReport += chunk.byteLength;

          const now = performance.now();
          const pct = Math.min(100, Math.round((offset / totalSize) * 100));
          progressBar.style.width = `${pct}%`;
          progressText.textContent = `${pct}%`;

          if (now - lastReportTime > 200) {
            const timeDiffSec = (now - lastReportTime) / 1000;
            const speed = (bytesSinceReport / timeDiffSec) / (1024 * 1024);
            speedText.textContent = `${speed.toFixed(1)} MB/s`;
            lastReportTime = now;
            bytesSinceReport = 0;
          }
        }
        if (isProcessing) {
          finalHex = md5Instance.finalize();
        }
      } else {
        // Web Crypto API Algorithms: SHA-1, SHA-256, SHA-384, SHA-512
        // Note: For chunked streaming with WebCrypto in browser without WebStreams, read entire buffer if <50MB or process incrementally.
        // For standard WebCrypto API, we can read chunks and use a stream transformer or ArrayBuffer concatenate for high accuracy.
        // For file sizes up to high limits, read in 10MB chunks into Uint8Array buffer or SubtleCrypto digest.

        if (totalSize <= 100 * 1024 * 1024) {
          // File <= 100MB: Direct Web Crypto Digest
          speedText.textContent = 'Reading file into memory...';
          const buffer = await readSlice(file, 0, totalSize);
          speedText.textContent = 'Calculating hash with Web Crypto...';
          progressBar.style.width = '70%';
          progressText.textContent = '70%';

          const hashBuf = await crypto.subtle.digest(algo, buffer);
          finalHex = arrayBufferToHex(hashBuf);
          progressBar.style.width = '100%';
          progressText.textContent = '100%';
        } else {
          // File > 100MB: Progressive Buffer Reading
          const chunks = [];
          let lastReportTime = startTime;
          let bytesSinceReport = 0;

          while (offset < totalSize && isProcessing) {
            const chunk = await readSlice(file, offset, offset + CHUNK_SIZE);
            chunks.push(new Uint8Array(chunk));

            offset += chunk.byteLength;
            bytesSinceReport += chunk.byteLength;

            const now = performance.now();
            const pct = Math.min(90, Math.round((offset / totalSize) * 90));
            progressBar.style.width = `${pct}%`;
            progressText.textContent = `${pct}% (Reading)`;

            if (now - lastReportTime > 200) {
              const timeDiffSec = (now - lastReportTime) / 1000;
              const speed = (bytesSinceReport / timeDiffSec) / (1024 * 1024);
              speedText.textContent = `${speed.toFixed(1)} MB/s`;
              lastReportTime = now;
              bytesSinceReport = 0;
            }
          }

          if (isProcessing) {
            speedText.textContent = 'Finalizing Web Crypto hash...';
            const totalBuffer = new Uint8Array(totalSize);
            let pos = 0;
            for (const c of chunks) {
              totalBuffer.set(c, pos);
              pos += c.length;
            }
            const hashBuf = await crypto.subtle.digest(algo, totalBuffer.buffer);
            finalHex = arrayBufferToHex(hashBuf);
            progressBar.style.width = '100%';
            progressText.textContent = '100%';
          }
        }
      }

      if (!isProcessing) return;

      const elapsed = ((performance.now() - startTime) / 1000).toFixed(2);
      timeTakenEl.textContent = `${elapsed}s`;

      displayResult(finalHex);
    } catch (err) {
      if (err.name !== 'AbortError') {
        alert('Error computing hash: ' + err.message);
      }
    } finally {
      isProcessing = false;
      startBtn.style.display = 'inline-flex';
      cancelBtn.style.display = 'none';
    }
  }

  function readSlice(file, start, end) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      currentReader = reader;
      const slice = file.slice(start, end);
      reader.onload = (e) => resolve(e.target.result);
      reader.onerror = (e) => reject(e.target.error);
      reader.onabort = () => reject(new DOMException('Aborted', 'AbortError'));
      reader.readAsArrayBuffer(slice);
    });
  }

  function arrayBufferToHex(buffer) {
    const byteArray = new Uint8Array(buffer);
    const hexCodes = [];
    for (let i = 0; i < byteArray.length; i++) {
      hexCodes.push(byteArray[i].toString(16).padStart(2, '0'));
    }
    return hexCodes.join('');
  }

  function displayResult(rawHex) {
    resultsSection.style.display = 'block';
    currentRawHex = rawHex;
    updateHashOutputCase();
    checkCompare();
    resultsSection.scrollIntoView({ behavior: 'smooth' });
  }

  let currentRawHex = '';

  function updateHashOutputCase() {
    if (!currentRawHex) return;
    hashOutput.textContent = isUppercase ? currentRawHex.toUpperCase() : currentRawHex.toLowerCase();
  }

  caseToggleBtn.addEventListener('click', () => {
    isUppercase = !isUppercase;
    caseToggleBtn.textContent = isUppercase ? 'UPPERCASE' : 'lowercase';
    updateHashOutputCase();
  });

  // Copy buttons
  copyHashBtn.addEventListener('click', () => copyToClipboard(hashOutput.textContent, copyHashBtn));
  copyCertutilBtn.addEventListener('click', () => copyToClipboard(certutilCmd.textContent, copyCertutilBtn));
  copyPsBtn.addEventListener('click', () => copyToClipboard(psCmd.textContent, copyPsBtn));

  function copyToClipboard(text, btnElement) {
    navigator.clipboard.writeText(text).then(() => {
      const origText = btnElement.textContent;
      btnElement.textContent = 'Copied!';
      btnElement.classList.add('copied');
      setTimeout(() => {
        btnElement.textContent = origText;
        btnElement.classList.remove('copied');
      }, 1800);
    }).catch(err => {
      alert('Failed to copy: ' + err);
    });
  }

  // Hash Match Comparison
  expectedHashInput.addEventListener('input', checkCompare);

  function checkCompare() {
    const expected = expectedHashInput.value.trim().toLowerCase();
    if (!expected || !currentRawHex) {
      compareStatus.style.display = 'none';
      return;
    }

    compareStatus.style.display = 'inline-block';
    if (expected === currentRawHex.toLowerCase()) {
      compareStatus.textContent = 'MATCH ✓';
      compareStatus.className = 'compare-tag match';
    } else {
      compareStatus.textContent = 'MISMATCH ✗';
      compareStatus.className = 'compare-tag mismatch';
    }
  }
});
