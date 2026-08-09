// ============ Cloud Sync & Enhancements ============
const FIREBASE_API_KEY = 'AIzaSyC6BpyH6C9VXpEAknUriR6yo9Z0BNeOuRQ';
const FIREBASE_PROJECT = 'ojwin-crm';
const FIRESTORE_BASE = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT}/databases/(default)/documents`;

// State
let syncStatus = 'idle'; // idle, loading, synced, error
let lastSyncTime = null;
let searchQuery = '';
let filterStatus = '';
let sortField = 'createdAt';
let sortOrder = 'desc';
let currentPage = 1;
const PAGE_SIZE = 20;
let darkMode = false;

// Status mapping (Firestore <-> PWA)
const STATUS_MAP = {
  'Hot': 'تماس اول',
  'Warm': 'بازدید',
  'Cold': 'تماس اول',
  'Contacted': 'قرارداد',
  'Closed': 'تحویل'
};
const REVERSE_STATUS_MAP = {
  'تماس اول': 'Warm',
  'بازدید': 'Warm',
  'قرارداد': 'Contacted',
  'تحویل': 'Closed'
};

// ============ API Helpers ============
async function firestoreRequest(path, method = 'GET', body = null) {
  const url = `${FIRESTORE_BASE}/${path}?key=${FIREBASE_API_KEY}`;
  const options = { method };
  if (body) options.headers = { 'Content-Type': 'application/json' };
  if (body) options.body = JSON.stringify(body);
  
  try {
    const response = await fetch(url, options);
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error?.message || `HTTP ${response.status}`);
    }
    return await response.json();
  } catch (err) {
    console.error('Firestore error:', err);
    throw err;
  }
}

// ============ Sync Functions ============
async function syncFromFirestore() {
  syncStatus = 'loading';
  updateSyncIndicator();
  
  try {
    // Sync customers
    let leadsResponse = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      try { leadsResponse = await firestoreRequest('leads'); break; }
      catch (e) {
        window.__syncErr = String((e && e.message) || e);
        if (attempt === 2) throw e;
        await new Promise(r => setTimeout(r, 1500));
      }
    }
    const leads = leadsResponse.documents || [];
    
    const firestoreCustomers = leads.map(doc => {
      const fields = doc.fields || {};
      const id = doc.name.split('/').pop();
      
      return {
        id,
        name: fields.name?.stringValue || 'بدون نام',
        phone: fields.phone?.stringValue || '',
        service: fields.service?.stringValue || '',
        address: fields.address?.stringValue || '',
        description: fields.description?.stringValue || '',
        status: STATUS_MAP[fields.status?.stringValue] || 'تماس اول',
        source: fields.source?.stringValue || 'لندینگ',
        createdAt: doc.createTime || new Date().toISOString(),
        nextFollowup: fields.nextFollowup?.stringValue || null,
        notes: fields.notes?.stringValue || ''
      };
    });
    
    // Merge with local data (firestore wins for conflicts)
    const localIds = new Set(data.customers.map(c => c.id));
    const mergedCustomers = [...data.customers];
    
    firestoreCustomers.forEach(fc => {
      const existingIndex = mergedCustomers.findIndex(c => c.id === fc.id);
      if (existingIndex >= 0) {
        // Update existing
        mergedCustomers[existingIndex] = { ...mergedCustomers[existingIndex], ...fc };
      } else {
        // Add new
        mergedCustomers.push(fc);
      }
    });
    
    data.customers = mergedCustomers;
    await saveData();
    
    syncStatus = 'synced';
    lastSyncTime = new Date();
    updateSyncIndicator();
    
    return true;
  } catch (err) {
    syncStatus = 'error';
    window.__syncErr = String((err && err.message) || err);
    updateSyncIndicator();
    console.error('Sync from Firestore failed:', err);
    window.__syncErr = String((err && err.message) || err);
    window.__syncErr = String((err && err.message) || err);
    return false;
  }
}

async function syncToFirestore(customer) {
  try {
    const body = fieldsFor(customer);
    const masks = ['name','phone','service','address','description','status','source','nextFollowup','notes']
      .map(function(f){ return 'updateMask.fieldPaths=' + f; }).join('&');
    const ct = { 'Content-Type': 'application/json' };
    let res = await fetch(FIRESTORE_BASE + '/leads/' + encodeURIComponent(customer.id) + '?key=' + FIREBASE_API_KEY + '&' + masks, {
      method: 'PATCH', headers: ct, body: JSON.stringify(body)
    });
    if (res.status === 404) {
      res = await fetch(FIRESTORE_BASE + '/leads?key=' + FIREBASE_API_KEY + '&documentId=' + encodeURIComponent(customer.id), {
        method: 'POST', headers: ct, body: JSON.stringify(body)
      });
    }
    if (!res.ok) {
      const t = await res.text();
      throw new Error('HTTP ' + res.status + ' ' + t.slice(0, 80));
    }
    return true;
  } catch (err) {
    console.error('Sync to Firestore failed:', err);
    window.__syncErr = String((err && err.message) || err);
    alert('خطا در ذخیره به سرور. تغییرات فقط محلی ذخیره شد. | ' + window.__syncErr);
    return false;
  }
}

async function deleteFromFirestore(customerId) {
  try {
    const path = `leads/${customerId}`;
    await firestoreRequest(path, 'DELETE');
    return true;
  } catch (err) {
    console.error('Delete from Firestore failed:', err);
    return false;
  }
}

// ============ UI Enhancements ============
function updateSyncIndicator() {
  const indicator = document.getElementById('sync-indicator');
  if (!indicator) return;
  
  if (syncStatus === 'loading') {
    indicator.innerHTML = '🔄 در حال همگام‌سازی...';
    indicator.className = 'sync-indicator loading';
  } else if (syncStatus === 'synced') {
    const timeStr = lastSyncTime ? lastSyncTime.toLocaleTimeString('fa-IR') : '';
    indicator.innerHTML = `✅ همگام‌سازی شد ${timeStr}`;
    indicator.className = 'sync-indicator synced';
  } else if (syncStatus === 'error') {
    indicator.innerHTML = '⚠️ خطا: ' + (window.__syncErr || 'نامشخص');
    indicator.className = 'sync-indicator error';
  } else {
    indicator.innerHTML = '';
    indicator.className = 'sync-indicator';
  }
}

function getFilteredCustomers() {
  let filtered = [...data.customers];
  
  // Search
  if (searchQuery) {
    const q = searchQuery.toLowerCase();
    filtered = filtered.filter(c => 
      (c.name || '').toLowerCase().includes(q) ||
      (c.phone || '').toLowerCase().includes(q) ||
      (c.service || '').toLowerCase().includes(q) ||
      (c.address || '').toLowerCase().includes(q) ||
      (c.notes || '').toLowerCase().includes(q)
    );
  }
  
  // Filter by status
  if (filterStatus) {
    filtered = filtered.filter(c => c.status === filterStatus);
  }
  
  // Sort
  filtered.sort((a, b) => {
    let valA = a[sortField] || '';
    let valB = b[sortField] || '';
    
    if (sortField === 'createdAt' || sortField === 'nextFollowup') {
      valA = new Date(valA || '1900-01-01');
      valB = new Date(valB || '1900-01-01');
    }
    
    if (sortOrder === 'asc') {
      return valA > valB ? 1 : valA < valB ? -1 : 0;
    } else {
      return valA < valB ? 1 : valA > valB ? -1 : 0;
    }
  });
  
  return filtered;
}

function getPaginatedCustomers() {
  const filtered = getFilteredCustomers();
  const start = (currentPage - 1) * PAGE_SIZE;
  const end = start + PAGE_SIZE;
  return filtered.slice(start, end);
}

function getTotalPages() {
  return Math.ceil(getFilteredCustomers().length / PAGE_SIZE);
}

// ============ Export to Excel ============
function exportToExcel() {
  const customers = getFilteredCustomers();
  
  // Create CSV
  const headers = ['نام', 'تلفن', 'خدمت', 'آدرس', 'وضعیت', 'منبع', 'تاریخ ایجاد', 'یادداشت'];
  const rows = customers.map(c => [
    c.name || '',
    c.phone || '',
    c.service || '',
    c.address || '',
    c.status || '',
    c.source || '',
    c.createdAt || '',
    c.notes || ''
  ]);
  
  const csv = [headers, ...rows].map(row => 
    row.map(cell => `"${(cell + '').replace(/"/g, '""')}"`).join(',')
  ).join('\n');
  
  const BOM = '\uFEFF'; // UTF-8 BOM for Excel
  const blob = new Blob([BOM + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `customers-${todayISO()}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}


function initDarkMode() {
}

// ============ Enhanced Validation ============
function validateCustomer(customer) {
  const errors = [];
  
  if (!customer.name || customer.name.trim().length < 2) {
    errors.push('نام باید حداقل ۲ کاراکتر باشد');
  }
  
  if (customer.phone && !/^[\d\s\-\+\(\)]{10,15}$/.test(customer.phone)) {
    errors.push('شماره تلفن معتبر نیست');
  }
  
  return errors;
}

// ============ Enhanced Save ============
async function enhancedSaveCustomer(customer) {
  const errors = validateCustomer(customer);
  if (errors.length > 0) {
    alert('خطا:\n' + errors.join('\n'));
    return false;
  }
  
  // Save locally
  const existingIndex = data.customers.findIndex(c => c.id === customer.id);
  if (existingIndex >= 0) {
    data.customers[existingIndex] = customer;
  } else {
    data.customers.push(customer);
  }
  await saveData();
  
  // Sync to Firestore
  await syncToFirestore(customer);
  
  return true;
}

async function enhancedDeleteCustomer(customerId) {
  // Delete locally
  data.customers = data.customers.filter(c => c.id !== customerId);
  await saveData();
  
  // Delete from Firestore
  await deleteFromFirestore(customerId);
}

// ============ Render Search/Filter UI ============
function renderSearchFilter() {
  return `
    <div class="search-filter-bar" style="padding:12px;background:var(--card-bg);margin:8px;border-radius:8px;">
      <input type="text" id="search-input" placeholder="🔍 جستجو در همه فیلدها..." 
             value="${searchQuery}" style="width:100%;padding:8px;margin-bottom:8px;border-radius:6px;border:1px solid #ddd;">
      
      <div style="display:flex;gap:8px;flex-wrap:wrap;">
        <select id="filter-status" style="flex:1;min-width:120px;padding:8px;border-radius:6px;border:1px solid #ddd;">
          <option value="">همه وضعیت‌ها</option>
          <option value="تماس اول" ${filterStatus==='تماس اول'?'selected':''}>تماس اول</option>
          <option value="بازدید" ${filterStatus==='بازدید'?'selected':''}>بازدید</option>
          <option value="قرارداد" ${filterStatus==='قرارداد'?'selected':''}>قرارداد</option>
          <option value="تحویل" ${filterStatus==='تحویل'?'selected':''}>تحویل</option>
        </select>
        
        <select id="sort-field" style="flex:1;min-width:120px;padding:8px;border-radius:6px;border:1px solid #ddd;">
          <option value="createdAt" ${sortField==='createdAt'?'selected':''}>تاریخ ایجاد</option>
          <option value="name" ${sortField==='name'?'selected':''}>نام</option>
          <option value="status" ${sortField==='status'?'selected':''}>وضعیت</option>
          <option value="nextFollowup" ${sortField==='nextFollowup'?'selected':''}>پیگیری بعدی</option>
        </select>
        
        <button id="sort-order" style="padding:8px 12px;border-radius:6px;border:1px solid #ddd;background:white;cursor:pointer;">
          ${sortOrder==='asc'?'⬆️':'⬇️'}
        </button>
        
        <button id="export-excel" style="padding:8px 12px;border-radius:6px;border:none;background:#22c55e;color:white;cursor:pointer;">
          📊 Excel
        </button>
      </div>
    </div>
  `;
}

function renderPagination() {
  const totalPages = getTotalPages();
  if (totalPages <= 1) return '';
  
  let pagination = '<div style="display:flex;justify-content:center;gap:8px;padding:12px;">';
  
  if (currentPage > 1) {
    pagination += `<button onclick="changePage(${currentPage-1})" style="padding:6px 12px;border-radius:6px;border:1px solid #ddd;background:white;cursor:pointer;">قبلی</button>`;
  }
  
  for (let i = 1; i <= totalPages; i++) {
    if (i === currentPage) {
      pagination += `<button style="padding:6px 12px;border-radius:6px;border:none;background:#3b82f6;color:white;cursor:pointer;">${i}</button>`;
    } else {
      pagination += `<button onclick="changePage(${i})" style="padding:6px 12px;border-radius:6px;border:1px solid #ddd;background:white;cursor:pointer;">${i}</button>`;
    }
  }
  
  if (currentPage < totalPages) {
    pagination += `<button onclick="changePage(${currentPage+1})" style="padding:6px 12px;border-radius:6px;border:1px solid #ddd;background:white;cursor:pointer;">بعدی</button>`;
  }
  
  pagination += '</div>';
  return pagination;
}

function changePage(page) {
  currentPage = page;
  render();
}

// ============ Init Cloud ============
async function initCloud() {
  
  
  // Add sync indicator
  if (!document.getElementById('sync-indicator')) {
    const indicator = document.createElement('div');
    indicator.id = 'sync-indicator';
    indicator.className = 'sync-indicator';
    indicator.style.cssText = 'position:fixed;top:10px;right:10px;padding:8px 12px;background:rgba(0,0,0,0.8);color:white;border-radius:6px;font-size:12px;z-index:9999;';
    document.body.appendChild(indicator);
  }
  
  // Sync from Firestore
  await syncFromFirestore();
  
  // Auto-sync every 5 minutes
  setInterval(syncFromFirestore, 5 * 60 * 1000);
}


// ============ One-time migration of local customers to Firestore ============
function fieldsFor(c){
  return { fields: {
    name:{stringValue:c.name||''},
    phone:{stringValue:c.phone||''},
    service:{stringValue:c.service||''},
    address:{stringValue:c.address||''},
    description:{stringValue:c.description||''},
    status:{stringValue:REVERSE_STATUS_MAP[c.status]||c.status||'Cold'},
    source:{stringValue:c.source||'PWA'},
    nextFollowup:{stringValue:c.nextFollowup||''},
    notes:{stringValue:c.notes||''}
  }};
}
async function pushLocalCustomers(){
  try{
    const res = await firestoreRequest('leads');
    const remoteIds = new Set((res.documents||[]).map(function(d){return d.name.split('/').pop();}));
    for(const c of (data.customers||[])){
      if(remoteIds.has(c.id)) continue;
      await fetch(FIRESTORE_BASE + '/leads?key=' + FIREBASE_API_KEY + '&documentId=' + encodeURIComponent(c.id), {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify(fieldsFor(c))
      });
      console.log('migrated:', c.name);
    }
  }catch(e){ console.error('migration error:', e); }
}
window.addEventListener('load', function(){ setTimeout(pushLocalCustomers, 3000); });
