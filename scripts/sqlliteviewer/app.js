/**
 * SQLite Viewer - Main Application Module
 * Client-side offline processing for SQLite databases using WebAssembly.
 */

(function () {
  'use strict';

  // Global state
  let SQL = null;
  let db = null;
  let dbFileName = '';
  let dbFileSize = 0;
  let schemaData = []; // [{ name: string, type: string, sql: string, columns: [{cid, name, type, notnull, dflt_value, pk}] }]
  let activeTable = null;
  let activeViewMode = 'data'; // 'data' | 'structure'
  
  // Data Pagination State
  let currentPage = 1;
  let pageSize = 50;
  let totalRows = 0;
  let currentSort = { column: null, dir: 'ASC' };
  let currentFilter = '';
  
  // History State
  let queryHistory = [];

  // DOM Elements
  const el = {
    dropZone: document.getElementById('drop-zone'),
    fileInput: document.getElementById('file-input'),
    btnSelectFile: document.getElementById('btn-select-file'),
    btnOpenSample: document.getElementById('btn-open-sample'),
    loadingOverlay: document.getElementById('loading-overlay'),
    loadingText: document.getElementById('loading-text'),

    // Main layout panels
    uploadSection: document.getElementById('upload-section'),
    workspaceSection: document.getElementById('workspace-section'),
    
    // Header & Info
    dbTitle: document.getElementById('db-title'),
    dbMeta: document.getElementById('db-meta'),
    btnCloseDb: document.getElementById('btn-close-db'),
    btnExportDb: document.getElementById('btn-export-db'),
    
    // Tabs & Filters
    tableSearch: document.getElementById('table-search'),
    tablesList: document.getElementById('tables-list'),
    tableCountBadge: document.getElementById('table-count-badge'),
    tabData: document.getElementById('tab-data'),
    tabStructure: document.getElementById('tab-structure'),
    tabQuery: document.getElementById('tab-query'),
    
    // Views
    viewData: document.getElementById('view-data'),
    viewStructure: document.getElementById('view-structure'),
    viewQuery: document.getElementById('view-query'),
    
    // Table Header Action bar
    activeTableName: document.getElementById('active-table-name'),
    activeTableBadge: document.getElementById('active-table-badge'),
    dataSearchInput: document.getElementById('data-search-input'),
    btnExportCsv: document.getElementById('btn-export-csv'),
    btnExportJson: document.getElementById('btn-export-json'),
    btnRefreshTable: document.getElementById('btn-refresh-table'),
    
    // Table Data Render Area
    tableDataContainer: document.getElementById('table-data-container'),
    paginationInfo: document.getElementById('pagination-info'),
    pageSizeSelect: document.getElementById('page-size-select'),
    btnPrevPage: document.getElementById('btn-prev-page'),
    btnNextPage: document.getElementById('btn-next-page'),
    
    // Structure View Render Area
    structureContainer: document.getElementById('structure-container'),
    
    // Query View Elements
    queryEditor: document.getElementById('query-editor'),
    btnRunQuery: document.getElementById('btn-run-query'),
    btnClearQuery: document.getElementById('btn-clear-query'),
    queryResultContainer: document.getElementById('query-result-container'),
    queryHistoryList: document.getElementById('query-history-list'),
    
    // Settings & Theme
    btnThemeToggle: document.getElementById('btn-theme-toggle'),
    themeIcon: document.getElementById('theme-icon'),
    btnSettings: document.getElementById('btn-settings'),
    settingsModal: document.getElementById('settings-modal'),
    btnCloseSettings: document.getElementById('btn-close-settings'),
    btnSaveSettings: document.getElementById('btn-save-settings'),
    btnResetSettings: document.getElementById('btn-reset-settings'),
    selectTheme: document.getElementById('select-theme'),
    selectFontSans: document.getElementById('select-font-sans'),
    selectFontMono: document.getElementById('select-font-mono'),
    selectFontSize: document.getElementById('select-font-size'),

    // Toast
    toast: document.getElementById('toast')
  };

  // Toast Notification Helper
  function showToast(message, type = 'info') {
    if (!el.toast) return;
    el.toast.textContent = message;
    el.toast.className = `toast show ${type}`;
    setTimeout(() => {
      el.toast.className = 'toast';
    }, 3200);
  }

  // Show / Hide Loading
  function setLoading(show, text = 'Processing database...') {
    if (show) {
      el.loadingText.textContent = text;
      el.loadingOverlay.style.display = 'flex';
    } else {
      el.loadingOverlay.style.display = 'none';
    }
  }

  // Format File Size
  function formatBytes(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  // Escape HTML string
  function escapeHtml(str) {
    if (str === null || str === undefined) return '<span class="null-val">NULL</span>';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // Initialize sql.js WebAssembly
  async function initSql() {
    try {
      setLoading(true, 'Initializing SQLite Wasm Engine...');
      if (typeof initSqlJs !== 'function') {
        throw new Error('sql.js library failed to load.');
      }

      // Check if Wasm data is pre-embedded as Base64 for local file:// protocol access
      let wasmBinary = null;
      if (window.SQL_WASM_BASE64) {
        const binaryString = atob(window.SQL_WASM_BASE64);
        const len = binaryString.length;
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }
        wasmBinary = bytes.buffer;
      }

      const config = {
        locateFile: file => `./scripts/sql-wasm/${file}`
      };

      if (wasmBinary) {
        config.wasmBinary = wasmBinary;
      }

      SQL = await initSqlJs(config);

      setLoading(false);
    } catch (err) {
      setLoading(false);
      console.error(err);
      showToast('Failed to initialize SQLite Wasm: ' + err.message, 'error');
    }
  }

  // Initialize Event Listeners
  function initEvents() {
    // File Input Drag & Drop
    if (el.dropZone) {
      ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
        el.dropZone.addEventListener(eventName, preventDefaults, false);
      });

      function preventDefaults(e) {
        e.preventDefault();
        e.stopPropagation();
      }

      ['dragenter', 'dragover'].forEach(eventName => {
        el.dropZone.addEventListener(eventName, () => el.dropZone.classList.add('dragover'), false);
      });

      ['dragleave', 'drop'].forEach(eventName => {
        el.dropZone.addEventListener(eventName, () => el.dropZone.classList.remove('dragover'), false);
      });

      el.dropZone.addEventListener('drop', (e) => {
        const dt = e.dataTransfer;
        const files = dt.files;
        if (files.length > 0) {
          handleFile(files[0]);
        }
      });
    }

    if (el.btnSelectFile) {
      el.btnSelectFile.addEventListener('click', () => el.fileInput.click());
    }

    if (el.fileInput) {
      el.fileInput.addEventListener('change', (e) => {
        if (e.target.files.length > 0) {
          handleFile(e.target.files[0]);
        }
      });
    }

    // Sample Database Loader
    if (el.btnOpenSample) {
      el.btnOpenSample.addEventListener('click', createSampleDatabase);
    }

    // Close DB
    if (el.btnCloseDb) {
      el.btnCloseDb.addEventListener('click', closeDatabase);
    }

    // Export DB
    if (el.btnExportDb) {
      el.btnExportDb.addEventListener('click', exportDatabaseFile);
    }

    // Table Search Sidebar
    if (el.tableSearch) {
      el.tableSearch.addEventListener('input', (e) => filterSidebarTables(e.target.value));
    }

    // Tab Switchers
    if (el.tabData) el.tabData.addEventListener('click', () => switchMainTab('data'));
    if (el.tabStructure) el.tabStructure.addEventListener('click', () => switchMainTab('structure'));
    if (el.tabQuery) el.tabQuery.addEventListener('click', () => switchMainTab('query'));

    // Data Filtering & Pagination
    if (el.dataSearchInput) {
      let debounceTimer;
      el.dataSearchInput.addEventListener('input', (e) => {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
          currentFilter = e.target.value.trim();
          currentPage = 1;
          renderTableData();
        }, 300);
      });
    }

    if (el.pageSizeSelect) {
      el.pageSizeSelect.addEventListener('change', (e) => {
        pageSize = parseInt(e.target.value, 10);
        currentPage = 1;
        renderTableData();
      });
    }

    if (el.btnPrevPage) {
      el.btnPrevPage.addEventListener('click', () => {
        if (currentPage > 1) {
          currentPage--;
          renderTableData();
        }
      });
    }

    if (el.btnNextPage) {
      el.btnNextPage.addEventListener('click', () => {
        const maxPages = Math.ceil(totalRows / pageSize) || 1;
        if (currentPage < maxPages) {
          currentPage++;
          renderTableData();
        }
      });
    }

    if (el.btnRefreshTable) {
      el.btnRefreshTable.addEventListener('click', () => {
        refreshSchemaAndData();
        showToast('Refreshed table data', 'success');
      });
    }

    // Exports
    if (el.btnExportCsv) el.btnExportCsv.addEventListener('click', exportCurrentTableCsv);
    if (el.btnExportJson) el.btnExportJson.addEventListener('click', exportCurrentTableJson);

    // Query Execution
    if (el.btnRunQuery) el.btnRunQuery.addEventListener('click', executeCustomQuery);
    if (el.btnClearQuery) {
      el.btnClearQuery.addEventListener('click', () => {
        el.queryEditor.value = '';
        el.queryEditor.focus();
      });
    }

    // Keyboard shortcut for Query editor (Ctrl+Enter / Cmd+Enter)
    if (el.queryEditor) {
      el.queryEditor.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
          e.preventDefault();
          executeCustomQuery();
        }
      });
    }

    // Theme & Appearance Customization Events
    if (el.btnThemeToggle) {
      el.btnThemeToggle.addEventListener('click', toggleTheme);
    }

    if (el.btnSettings) {
      el.btnSettings.addEventListener('click', openSettingsModal);
    }

    if (el.btnCloseSettings) {
      el.btnCloseSettings.addEventListener('click', closeSettingsModal);
    }

    if (el.btnSaveSettings) {
      el.btnSaveSettings.addEventListener('click', () => {
        saveSettingsFromModal();
        closeSettingsModal();
      });
    }

    if (el.btnResetSettings) {
      el.btnResetSettings.addEventListener('click', resetSettingsDefaults);
    }

    if (el.settingsModal) {
      el.settingsModal.addEventListener('click', (e) => {
        if (e.target === el.settingsModal) closeSettingsModal();
      });
    }
  }

  // Load and apply saved Theme & Font Preferences from localStorage
  function applySavedPreferences() {
    const savedTheme = localStorage.getItem('sql_viewer_theme') || 'dark';
    const savedSans = localStorage.getItem('sql_viewer_font_sans') || "'Outfit', sans-serif";
    const savedMono = localStorage.getItem('sql_viewer_font_mono') || "'JetBrains Mono', monospace";
    const savedSize = localStorage.getItem('sql_viewer_font_size') || "14px";

    setTheme(savedTheme);
    document.documentElement.style.setProperty('--font-sans', savedSans);
    document.documentElement.style.setProperty('--font-mono', savedMono);
    document.documentElement.style.setProperty('--base-font-size', savedSize);
  }

  function setTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('sql_viewer_theme', theme);
    if (el.themeIcon) {
      el.themeIcon.className = theme === 'light' ? 'fa-solid fa-sun' : 'fa-solid fa-moon';
    }
    if (el.selectTheme) el.selectTheme.value = theme;
  }

  function toggleTheme() {
    const current = document.documentElement.getAttribute('data-theme') || 'dark';
    const next = current === 'dark' ? 'light' : 'dark';
    setTheme(next);
    showToast(`Switched to ${next} theme`, 'info');
  }

  function openSettingsModal() {
    if (!el.settingsModal) return;
    const currentTheme = document.documentElement.getAttribute('data-theme') || 'dark';
    const currentSans = getComputedStyle(document.documentElement).getPropertyValue('--font-sans').trim() || "'Outfit', sans-serif";
    const currentMono = getComputedStyle(document.documentElement).getPropertyValue('--font-mono').trim() || "'JetBrains Mono', monospace";
    const currentSize = getComputedStyle(document.documentElement).getPropertyValue('--base-font-size').trim() || "14px";

    if (el.selectTheme) el.selectTheme.value = currentTheme;
    if (el.selectFontSans) el.selectFontSans.value = currentSans;
    if (el.selectFontMono) el.selectFontMono.value = currentMono;
    if (el.selectFontSize) el.selectFontSize.value = currentSize;

    el.settingsModal.style.display = 'flex';
  }

  function closeSettingsModal() {
    if (el.settingsModal) el.settingsModal.style.display = 'none';
  }

  function saveSettingsFromModal() {
    const theme = el.selectTheme ? el.selectTheme.value : 'dark';
    const fontSans = el.selectFontSans ? el.selectFontSans.value : "'Outfit', sans-serif";
    const fontMono = el.selectFontMono ? el.selectFontMono.value : "'JetBrains Mono', monospace";
    const fontSize = el.selectFontSize ? el.selectFontSize.value : "14px";

    setTheme(theme);
    document.documentElement.style.setProperty('--font-sans', fontSans);
    document.documentElement.style.setProperty('--font-mono', fontMono);
    document.documentElement.style.setProperty('--base-font-size', fontSize);

    localStorage.setItem('sql_viewer_font_sans', fontSans);
    localStorage.setItem('sql_viewer_font_mono', fontMono);
    localStorage.setItem('sql_viewer_font_size', fontSize);

    showToast('Appearance settings saved', 'success');
  }

  function resetSettingsDefaults() {
    setTheme('dark');
    document.documentElement.style.setProperty('--font-sans', "'Outfit', sans-serif");
    document.documentElement.style.setProperty('--font-mono', "'JetBrains Mono', monospace");
    document.documentElement.style.setProperty('--base-font-size', '14px');

    localStorage.removeItem('sql_viewer_theme');
    localStorage.removeItem('sql_viewer_font_sans');
    localStorage.removeItem('sql_viewer_font_mono');
    localStorage.removeItem('sql_viewer_font_size');

    if (el.selectTheme) el.selectTheme.value = 'dark';
    if (el.selectFontSans) el.selectFontSans.value = "'Outfit', sans-serif";
    if (el.selectFontMono) el.selectFontMono.value = "'JetBrains Mono', monospace";
    if (el.selectFontSize) el.selectFontSize.value = '14px';

    showToast('Reset appearance defaults', 'info');
  }

  // Handle Loading of an SQLite File
  async function handleFile(file) {
    if (!SQL) {
      showToast('Wasm Engine not ready yet. Please wait a moment.', 'warning');
      return;
    }

    try {
      setLoading(true, `Reading file ${file.name}...`);
      dbFileName = file.name;
      dbFileSize = file.size;

      const arrayBuffer = await file.arrayBuffer();
      const uInt8Array = new Uint8Array(arrayBuffer);

      if (db) db.close();
      db = new SQL.Database(uInt8Array);

      loadDatabaseSchema();
      setLoading(false);
      showToast(`Loaded ${file.name} successfully`, 'success');
    } catch (err) {
      setLoading(false);
      console.error(err);
      showToast('Error opening SQLite file: ' + err.message, 'error');
    }
  }

  // Create an in-memory sample SQLite database
  function createSampleDatabase() {
    if (!SQL) return;
    try {
      setLoading(true, 'Generating sample SQLite database...');
      dbFileName = 'sample_ecommerce.sqlite';
      
      if (db) db.close();
      db = new SQL.Database();

      // Execute DDL and initial sample data
      db.run(`
        CREATE TABLE categories (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          description TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE products (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          category_id INTEGER,
          sku TEXT UNIQUE NOT NULL,
          title TEXT NOT NULL,
          price REAL NOT NULL,
          stock INTEGER DEFAULT 0,
          is_active INTEGER DEFAULT 1,
          FOREIGN KEY (category_id) REFERENCES categories(id)
        );

        CREATE TABLE customers (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          first_name TEXT NOT NULL,
          last_name TEXT NOT NULL,
          email TEXT UNIQUE NOT NULL,
          city TEXT,
          country TEXT
        );

        CREATE TABLE orders (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          customer_id INTEGER NOT NULL,
          total_amount REAL NOT NULL,
          status TEXT CHECK(status IN ('pending', 'completed', 'shipped', 'cancelled')) DEFAULT 'pending',
          order_date DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (customer_id) REFERENCES customers(id)
        );

        INSERT INTO categories (name, description) VALUES
          ('Electronics', 'Gadgets, smartphones, computers and smart home equipment'),
          ('Apparel & Fashion', 'Men and women clothing, footwear and accessories'),
          ('Home & Kitchen', 'Furniture, cookware and home decor items'),
          ('Books & Media', 'Paperbacks, ebooks, audiobooks and educational media');

        INSERT INTO products (category_id, sku, title, price, stock, is_active) VALUES
          (1, 'ELEC-MBP16', 'MacBook Pro 16" M3 Max', 3499.99, 14, 1),
          (1, 'ELEC-S24U', 'Samsung Galaxy S24 Ultra 512GB', 1299.99, 45, 1),
          (1, 'ELEC-WH1000', 'Sony WH-1000XM5 Headphones', 399.99, 82, 1),
          (2, 'FASH-JKT01', 'Leather Bomber Jacket', 249.50, 20, 1),
          (2, 'FASH-SLK02', 'Classic Cotton Denim Jeans', 79.99, 150, 1),
          (3, 'HOME-ESP01', 'DeLonghi Espresso Machine', 699.00, 8, 1),
          (3, 'HOME-AIR05', 'Dyson Air Purifier Tower', 499.99, 25, 1),
          (4, 'BOOK-DDIA0', 'Designing Data-Intensive Applications', 45.00, 200, 1),
          (4, 'BOOK-CCODE', 'Clean Code: A Handbook of Agile Craftsmanship', 38.95, 110, 1);

        INSERT INTO customers (first_name, last_name, email, city, country) VALUES
          ('Alice', 'Smith', 'alice.smith@example.com', 'San Francisco', 'USA'),
          ('Bob', 'Johnson', 'bob.j@example.org', 'London', 'UK'),
          ('Charlie', 'Brown', 'cbrown@example.io', 'Toronto', 'Canada'),
          ('Diana', 'Prince', 'diana@themyscira.net', 'New York', 'USA'),
          ('Evan', 'Wright', 'ewright@techcorp.com', 'Berlin', 'Germany');

        INSERT INTO orders (customer_id, total_amount, status) VALUES
          (1, 3899.98, 'completed'),
          (2, 249.50, 'shipped'),
          (3, 699.00, 'pending'),
          (4, 1344.99, 'completed'),
          (5, 45.00, 'completed');
      `);

      dbFileSize = db.export().byteLength;

      loadDatabaseSchema();
      setLoading(false);
      showToast('Sample database generated successfully', 'success');
    } catch (err) {
      setLoading(false);
      console.error(err);
      showToast('Failed to create sample database: ' + err.message, 'error');
    }
  }

  // Parse Database Schema
  function loadDatabaseSchema() {
    if (!db) return;

    // Get all tables and views
    const tablesRes = db.exec(`
      SELECT name, type, sql 
      FROM sqlite_master 
      WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite_%' 
      ORDER BY type ASC, name ASC
    `);

    schemaData = [];

    if (tablesRes.length > 0 && tablesRes[0].values) {
      tablesRes[0].values.forEach(row => {
        const tableName = row[0];
        const tableType = row[1];
        const tableSql = row[2];

        // Fetch pragma table_info
        let columns = [];
        try {
          const colRes = db.exec(`PRAGMA table_info("${tableName.replace(/"/g, '""')}")`);
          if (colRes.length > 0 && colRes[0].values) {
            columns = colRes[0].values.map(c => ({
              cid: c[0],
              name: c[1],
              type: c[2] || 'ANY',
              notnull: c[3] === 1,
              dflt_value: c[4],
              pk: c[5] === 1
            }));
          }
        } catch (e) {
          console.warn(`Could not get info for table ${tableName}`, e);
        }

        schemaData.push({
          name: tableName,
          type: tableType,
          sql: tableSql,
          columns: columns
        });
      });
    }

    // UI Updates
    el.uploadSection.style.display = 'none';
    el.workspaceSection.style.display = 'grid';
    el.dbTitle.textContent = dbFileName;
    el.dbMeta.textContent = `${schemaData.length} object(s) • ${formatBytes(dbFileSize)}`;
    el.tableCountBadge.textContent = schemaData.length;

    renderSidebarTables();

    // Select first table if available
    if (schemaData.length > 0) {
      selectTable(schemaData[0].name);
    } else {
      activeTable = null;
      switchMainTab('query');
      showToast('This SQLite database contains no user tables.', 'info');
    }
  }

  // Render list of tables in left sidebar
  function renderSidebarTables(filterText = '') {
    el.tablesList.innerHTML = '';

    const filtered = schemaData.filter(t => t.name.toLowerCase().includes(filterText.toLowerCase()));

    if (filtered.length === 0) {
      el.tablesList.innerHTML = `<li class="empty-state-sm">No matching tables found</li>`;
      return;
    }

    filtered.forEach(item => {
      const li = document.createElement('li');
      li.className = `table-item ${item.name === activeTable ? 'active' : ''}`;
      
      const icon = item.type === 'view' ? 'fa-eye' : 'fa-table';
      
      li.innerHTML = `
        <i class="fa-solid ${icon}"></i>
        <span class="table-name" title="${escapeHtml(item.name)}">${escapeHtml(item.name)}</span>
        <span class="table-type-badge">${item.type}</span>
      `;

      li.addEventListener('click', () => selectTable(item.name));
      el.tablesList.appendChild(li);
    });
  }

  function filterSidebarTables(text) {
    renderSidebarTables(text);
  }

  // Select active table and load data/structure
  function selectTable(tableName) {
    activeTable = tableName;
    renderSidebarTables(el.tableSearch ? el.tableSearch.value : '');

    el.activeTableName.textContent = tableName;
    const tableObj = schemaData.find(t => t.name === tableName);
    el.activeTableBadge.textContent = tableObj ? tableObj.type.toUpperCase() : 'TABLE';

    // Reset pagination & filters
    currentPage = 1;
    currentSort = { column: null, dir: 'ASC' };
    currentFilter = '';
    if (el.dataSearchInput) el.dataSearchInput.value = '';

    if (activeViewMode === 'data') {
      renderTableData();
    } else if (activeViewMode === 'structure') {
      renderTableStructure();
    } else {
      // Query view
      switchMainTab('data');
    }
  }

  // Refresh Schema and Re-render
  function refreshSchemaAndData() {
    if (!db) return;
    const prevSelected = activeTable;
    loadDatabaseSchema();
    if (prevSelected && schemaData.some(t => t.name === prevSelected)) {
      selectTable(prevSelected);
    }
  }

  // Switch tabs (Data / Structure / SQL Query)
  function switchMainTab(mode) {
    activeViewMode = mode;

    [el.tabData, el.tabStructure, el.tabQuery].forEach(t => t && t.classList.remove('active'));
    [el.viewData, el.viewStructure, el.viewQuery].forEach(v => v && (v.style.display = 'none'));

    if (mode === 'data') {
      el.tabData.classList.add('active');
      el.viewData.style.display = 'flex';
      renderTableData();
    } else if (mode === 'structure') {
      el.tabStructure.classList.add('active');
      el.viewStructure.style.display = 'flex';
      renderTableStructure();
    } else if (mode === 'query') {
      el.tabQuery.classList.add('active');
      el.viewQuery.style.display = 'flex';
      if (el.queryEditor && !el.queryEditor.value.trim() && activeTable) {
        el.queryEditor.value = `SELECT * FROM "${activeTable.replace(/"/g, '""')}" LIMIT 100;`;
      }
    }
  }

  // Render Table Data Grid
  function renderTableData() {
    if (!db || !activeTable) {
      el.tableDataContainer.innerHTML = '<div class="empty-state">No table selected</div>';
      return;
    }

    const tableObj = schemaData.find(t => t.name === activeTable);
    if (!tableObj) return;

    try {
      const sanitizedTableName = `"${activeTable.replace(/"/g, '""')}"`;
      
      // Build WHERE clause if search filter is typed
      let whereClause = '';
      if (currentFilter && tableObj.columns.length > 0) {
        const conditions = tableObj.columns.map(c => `"${c.name.replace(/"/g, '""')}" LIKE '%${currentFilter.replace(/'/g, "''")}%'`);
        whereClause = ` WHERE ${conditions.join(' OR ')}`;
      }

      // Count total rows
      const countRes = db.exec(`SELECT COUNT(*) FROM ${sanitizedTableName}${whereClause}`);
      totalRows = countRes.length > 0 ? countRes[0].values[0][0] : 0;

      // Build ORDER BY clause
      let orderByClause = '';
      if (currentSort.column) {
        orderByClause = ` ORDER BY "${currentSort.column.replace(/"/g, '""')}" ${currentSort.dir}`;
      }

      // Build LIMIT & OFFSET
      const offset = (currentPage - 1) * pageSize;
      const limitClause = ` LIMIT ${pageSize} OFFSET ${offset}`;

      // Run query
      const queryStr = `SELECT * FROM ${sanitizedTableName}${whereClause}${orderByClause}${limitClause}`;
      const dataRes = db.exec(queryStr);

      // Render Pagination Info
      const startRow = totalRows === 0 ? 0 : offset + 1;
      const endRow = Math.min(offset + pageSize, totalRows);
      el.paginationInfo.textContent = `Showing ${startRow} - ${endRow} of ${totalRows.toLocaleString()} rows`;

      const maxPage = Math.max(1, Math.ceil(totalRows / pageSize));
      el.btnPrevPage.disabled = currentPage <= 1;
      el.btnNextPage.disabled = currentPage >= maxPage;

      if (!dataRes || dataRes.length === 0 || dataRes[0].values.length === 0) {
        el.tableDataContainer.innerHTML = `<div class="empty-state"><i class="fa-solid fa-inbox"></i><p>No records found in this table.</p></div>`;
        return;
      }

      const columns = dataRes[0].columns;
      const rows = dataRes[0].values;

      // Build HTML Table
      let html = `<table class="grid-table"><thead><tr>`;
      
      columns.forEach(col => {
        let sortIcon = 'fa-sort';
        if (currentSort.column === col) {
          sortIcon = currentSort.dir === 'ASC' ? 'fa-sort-up' : 'fa-sort-down';
        }
        html += `
          <th data-column="${escapeHtml(col)}">
            <div class="th-content">
              <span>${escapeHtml(col)}</span>
              <i class="fa-solid ${sortIcon} sort-icon"></i>
            </div>
          </th>
        `;
      });
      html += `</tr></thead><tbody>`;

      rows.forEach(row => {
        html += `<tr>`;
        row.forEach(val => {
          if (val === null) {
            html += `<td><span class="null-tag">NULL</span></td>`;
          } else if (typeof val === 'number') {
            html += `<td class="num-cell">${val}</td>`;
          } else {
            html += `<td>${escapeHtml(val)}</td>`;
          }
        });
        html += `</tr>`;
      });

      html += `</tbody></table>`;
      el.tableDataContainer.innerHTML = html;

      // Attach Column Sort Listeners
      const headers = el.tableDataContainer.querySelectorAll('th');
      headers.forEach(th => {
        th.addEventListener('click', () => {
          const colName = th.getAttribute('data-column');
          if (currentSort.column === colName) {
            if (currentSort.dir === 'ASC') {
              currentSort.dir = 'DESC';
            } else {
              currentSort.column = null;
              currentSort.dir = 'ASC';
            }
          } else {
            currentSort.column = colName;
            currentSort.dir = 'ASC';
          }
          renderTableData();
        });
      });

    } catch (err) {
      console.error(err);
      el.tableDataContainer.innerHTML = `<div class="error-banner">Error rendering data: ${escapeHtml(err.message)}</div>`;
    }
  }

  // Render Table Structure (Columns & DDL)
  function renderTableStructure() {
    if (!db || !activeTable) {
      el.structureContainer.innerHTML = '<div class="empty-state">No table selected</div>';
      return;
    }

    const tableObj = schemaData.find(t => t.name === activeTable);
    if (!tableObj) return;

    let html = `
      <div class="structure-section">
        <h3><i class="fa-solid fa-columns"></i> Columns Definition</h3>
        <table class="grid-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Name</th>
              <th>Type</th>
              <th>Not Null</th>
              <th>Default Value</th>
              <th>Primary Key</th>
            </tr>
          </thead>
          <tbody>
    `;

    tableObj.columns.forEach((col, idx) => {
      html += `
        <tr>
          <td>${col.cid !== undefined ? col.cid : idx + 1}</td>
          <td><strong>${escapeHtml(col.name)}</strong></td>
          <td><span class="type-tag">${escapeHtml(col.type)}</span></td>
          <td>${col.notnull ? '<i class="fa-solid fa-check text-success"></i> Yes' : '<span class="text-muted">No</span>'}</td>
          <td>${col.dflt_value !== null ? `<code>${escapeHtml(col.dflt_value)}</code>` : '<span class="null-tag">NULL</span>'}</td>
          <td>${col.pk ? '<i class="fa-solid fa-key text-warning"></i> PK' : '-'}</td>
        </tr>
      `;
    });

    html += `
          </tbody>
        </table>
      </div>

      <div class="structure-section" style="margin-top: 2rem;">
        <h3><i class="fa-solid fa-code"></i> CREATE DDL Statement</h3>
        <pre class="code-block"><code>${escapeHtml(tableObj.sql || 'No DDL available for this view/table.')}</code></pre>
      </div>
    `;

    // Fetch Indexes
    try {
      const idxRes = db.exec(`PRAGMA index_list("${activeTable.replace(/"/g, '""')}")`);
      if (idxRes.length > 0 && idxRes[0].values.length > 0) {
        html += `
          <div class="structure-section" style="margin-top: 2rem;">
            <h3><i class="fa-solid fa-bolt"></i> Indexes</h3>
            <table class="grid-table">
              <thead>
                <tr>
                  <th>Seq</th>
                  <th>Index Name</th>
                  <th>Unique</th>
                  <th>Origin</th>
                </tr>
              </thead>
              <tbody>
        `;
        idxRes[0].values.forEach(row => {
          html += `
            <tr>
              <td>${row[0]}</td>
              <td><strong>${escapeHtml(row[1])}</strong></td>
              <td>${row[2] === 1 ? '<i class="fa-solid fa-check text-success"></i> Yes' : 'No'}</td>
              <td>${escapeHtml(row[3])}</td>
            </tr>
          `;
        });
        html += `</tbody></table></div>`;
      }
    } catch (e) {
      console.warn('Failed to fetch indexes', e);
    }

    el.structureContainer.innerHTML = html;
  }

  // Execute Arbitrary SQL Queries
  function executeCustomQuery() {
    if (!db) {
      showToast('No active database opened.', 'warning');
      return;
    }

    const query = el.queryEditor.value.trim();
    if (!query) {
      showToast('Please enter an SQL statement to run.', 'warning');
      return;
    }

    const startTime = performance.now();

    try {
      const results = db.exec(query);
      const executionTime = (performance.now() - startTime).toFixed(2);

      // Add to query history
      addQueryHistory(query, true, `${executionTime} ms`);

      if (!results || results.length === 0) {
        // Query succeeded without returning rows (e.g. UPDATE, INSERT, CREATE TABLE)
        el.queryResultContainer.innerHTML = `
          <div class="success-banner">
            <i class="fa-solid fa-circle-check"></i>
            <div>
              <strong>Statement executed successfully!</strong>
              <div class="time-meta">Execution time: ${executionTime} ms</div>
            </div>
          </div>
        `;
        // Refresh schema in case of DDL/DML changes
        refreshSchemaAndData();
        return;
      }

      // Render multiple result sets if batch query
      let html = `<div class="query-meta-bar">Execution time: ${executionTime} ms • ${results.length} result set(s)</div>`;

      results.forEach((res, index) => {
        html += `<div class="result-set-title">Result Set #${index + 1} (${res.values.length} rows)</div>`;
        html += `<div class="table-scroll-container"><table class="grid-table"><thead><tr>`;
        
        res.columns.forEach(col => {
          html += `<th>${escapeHtml(col)}</th>`;
        });
        html += `</tr></thead><tbody>`;

        res.values.forEach(row => {
          html += `<tr>`;
          row.forEach(val => {
            if (val === null) {
              html += `<td><span class="null-tag">NULL</span></td>`;
            } else if (typeof val === 'number') {
              html += `<td class="num-cell">${val}</td>`;
            } else {
              html += `<td>${escapeHtml(val)}</td>`;
            }
          });
          html += `</tr>`;
        });

        html += `</tbody></table></div>`;
      });

      el.queryResultContainer.innerHTML = html;

    } catch (err) {
      const executionTime = (performance.now() - startTime).toFixed(2);
      addQueryHistory(query, false, err.message);
      console.error(err);
      el.queryResultContainer.innerHTML = `
        <div class="error-banner">
          <i class="fa-solid fa-triangle-exclamation"></i>
          <div>
            <strong>SQL Error:</strong> ${escapeHtml(err.message)}
            <div class="time-meta">Execution time: ${executionTime} ms</div>
          </div>
        </div>
      `;
    }
  }

  // Manage Query History Sidebar
  function addQueryHistory(sql, isSuccess, metaText) {
    queryHistory.unshift({ sql, isSuccess, metaText, time: new Date().toLocaleTimeString() });
    if (queryHistory.length > 20) queryHistory.pop();

    if (!el.queryHistoryList) return;

    el.queryHistoryList.innerHTML = '';
    queryHistory.forEach(item => {
      const li = document.createElement('li');
      li.className = `history-item ${item.isSuccess ? 'success' : 'error'}`;
      li.innerHTML = `
        <div class="history-sql" title="${escapeHtml(item.sql)}">${escapeHtml(item.sql)}</div>
        <div class="history-meta">${item.time} • ${escapeHtml(item.metaText)}</div>
      `;
      li.addEventListener('click', () => {
        el.queryEditor.value = item.sql;
        el.queryEditor.focus();
      });
      el.queryHistoryList.appendChild(li);
    });
  }

  // Export current active table to CSV
  function exportCurrentTableCsv() {
    if (!db || !activeTable) return;
    try {
      const sanitizedTableName = `"${activeTable.replace(/"/g, '""')}"`;
      const res = db.exec(`SELECT * FROM ${sanitizedTableName}`);
      if (!res || res.length === 0) {
        showToast('No data to export', 'warning');
        return;
      }

      const columns = res[0].columns;
      const rows = res[0].values;

      let csvContent = columns.map(c => `"${c.replace(/"/g, '""')}"`).join(',') + '\n';

      rows.forEach(row => {
        const line = row.map(val => {
          if (val === null) return '""';
          return `"${String(val).replace(/"/g, '""')}"`;
        }).join(',');
        csvContent += line + '\n';
      });

      downloadFile(csvContent, `${activeTable}.csv`, 'text/csv;charset=utf-8;');
      showToast(`Exported ${activeTable}.csv`, 'success');
    } catch (e) {
      showToast('CSV Export failed: ' + e.message, 'error');
    }
  }

  // Export current active table to JSON
  function exportCurrentTableJson() {
    if (!db || !activeTable) return;
    try {
      const sanitizedTableName = `"${activeTable.replace(/"/g, '""')}"`;
      const res = db.exec(`SELECT * FROM ${sanitizedTableName}`);
      if (!res || res.length === 0) {
        showToast('No data to export', 'warning');
        return;
      }

      const columns = res[0].columns;
      const rows = res[0].values;

      const jsonData = rows.map(row => {
        const obj = {};
        columns.forEach((col, i) => {
          obj[col] = row[i];
        });
        return obj;
      });

      const jsonStr = JSON.stringify(jsonData, null, 2);
      downloadFile(jsonStr, `${activeTable}.json`, 'application/json');
      showToast(`Exported ${activeTable}.json`, 'success');
    } catch (e) {
      showToast('JSON Export failed: ' + e.message, 'error');
    }
  }

  // Download raw SQLite Database file
  function exportDatabaseFile() {
    if (!db) return;
    try {
      const binaryArray = db.export();
      const blob = new Blob([binaryArray], { type: 'application/x-sqlite3' });
      const exportName = dbFileName ? dbFileName.replace(/\.(sqlite|db|sqlite3)$/i, '') + '_mod.sqlite' : 'database.sqlite';
      
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = exportName;
      link.click();
      URL.revokeObjectURL(link.href);
      
      showToast('Downloaded SQLite database binary', 'success');
    } catch (e) {
      showToast('Exporting DB binary failed: ' + e.message, 'error');
    }
  }

  // Generic Download File Helper
  function downloadFile(content, fileName, mimeType) {
    const blob = new Blob([content], { type: mimeType });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = fileName;
    link.click();
    URL.revokeObjectURL(link.href);
  }

  // Reset & Close Database
  function closeDatabase() {
    if (db) {
      db.close();
      db = null;
    }
    dbFileName = '';
    dbFileSize = 0;
    schemaData = [];
    activeTable = null;

    el.workspaceSection.style.display = 'none';
    el.uploadSection.style.display = 'flex';
    el.fileInput.value = '';
    showToast('Closed database session', 'info');
  }

  // Initialize App on DOM Content Loaded
  document.addEventListener('DOMContentLoaded', () => {
    applySavedPreferences();
    initEvents();
    initSql();
  });

})();
