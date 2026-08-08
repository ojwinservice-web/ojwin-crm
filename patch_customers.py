import re

# Read the file
with open('/data/data/com.termux/files/home/ojwin-crm/index.html', 'r', encoding='utf-8') as f:
    content = f.read()

# New renderCustomers with search/filter UI
new_render_customers = '''function renderCustomers(){
  main.innerHTML = `
    ${renderSearchFilter()}
    <div id="custList"></div>
    ${renderPagination()}
  `;
  
  // Attach event listeners
  document.getElementById('search-input').addEventListener('input', (e) => {
    searchQuery = e.target.value;
    currentPage = 1;
    renderCustList();
  });
  
  document.getElementById('filter-status').addEventListener('change', (e) => {
    filterStatus = e.target.value;
    currentPage = 1;
    renderCustList();
  });
  
  document.getElementById('sort-field').addEventListener('change', (e) => {
    sortField = e.target.value;
    renderCustList();
  });
  
  document.getElementById('sort-order').addEventListener('click', () => {
    sortOrder = sortOrder === 'asc' ? 'desc' : 'asc';
    document.getElementById('sort-order').innerHTML = sortOrder === 'asc' ? '⬆️' : '⬇️';
    renderCustList();
  });
  
  document.getElementById('export-excel').addEventListener('click', exportToExcel);
  
  renderCustList();
}
'''

# New renderCustList with pagination
new_render_cust_list = '''function renderCustList(){
  const list = document.getElementById('custList');
  const paginated = getPaginatedCustomers();
  
  if(paginated.length === 0){
    list.innerHTML = emptyState('مشتری‌ای یافت نشد','یک مشتری جدید با دکمه + اضافه کن یا فیلترها را تغییر دهید.');
    return;
  }
  
  list.innerHTML = paginated.map(c => {
    let followChip = '';
    if(c.nextFollowup){
      if(c.nextFollowup < todayISO()) followChip = `<span class="chip red">پیگیری عقب‌افتاده</span>`;
      else if(c.nextFollowup === todayISO()) followChip = `<span class="chip gold">پیگیری امروز</span>`;
      else followChip = `<span class="chip">پیگیری: ${c.nextFollowup}</span>`;
    }
    return `
    <div class="contact-card">
      <div class="avatar">${initials(c.name)}</div>
      <div class="contact-info">
        <div class="contact-name">${c.name}</div>
        <div class="contact-sub">${c.source || '-'} ${followChip}</div>
      </div>
      <button class="icon-btn" data-call="${c.id}" style="background:#E6F4EA;"><svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke="var(--green)"><path d="M21 11.5a8.38 8.38 0 01-.9 3.8 8.5 8.5 0 01-7.6 4.7 8.4 8.4 0 01-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 01-.9-3.8 8.5 8.5 0 014.7-7.6 8.4 8.4 0 013.8-.9h.5a8.48 8.48 0 018 8v.5z"/></svg></button>
      <button class="icon-btn" data-edit="${c.id}"><svg viewBox="0 0 24 24" fill="none" stroke-width="2"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4L16.5 3.5z"/></svg></button>
    </div>`;
  }).join('');
  
  list.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', () => openCustomerForm(b.dataset.edit)));
  list.querySelectorAll('[data-call]').forEach(b => b.addEventListener('click', () => {
    const c = data.customers.find(x => x.id === b.dataset.call);
    if(c && c.phone) window.location.href = 'tel:' + c.phone;
    else alert('شماره تماسی برای این مشتری ثبت نشده.');
  }));
}
'''

# New openCustomerForm with enhanced save
new_open_customer_form = '''function openCustomerForm(id){
  const c = id ? data.customers.find(x => x.id === id) : null;
  openSheet(`
    <h3>${c ? 'ویرایش مشتری' : 'مشتری جدید'}</h3>
    <div class="field"><label>نام مشتری *</label><input id="f_name" value="${c ? c.name : ''}"></div>
    <div class="field"><label>شماره تماس</label><input id="f_phone" type="tel" value="${c ? c.phone || '' : ''}"></div>
    <div class="field"><label>آدرس</label><textarea id="f_address">${c ? c.address || '' : ''}</textarea></div>
    <div class="field"><label>خدمت درخواستی</label><input id="f_service" value="${c ? c.service || '' : ''}"></div>
    <div class="field"><label>منبع سرنخ</label><select id="f_source">${SOURCES.map(s => `<option ${c && c.source === s ? 'selected' : ''}>${s}</option>`).join('')}</select></div>
    <div class="field"><label>وضعیت پیگیری</label><select id="f_status">${FOLLOWUP_STATUSES.map(s => `<option ${c && c.status === s ? 'selected' : ''}>${s}</option>`).join('')}</select></div>
    <div class="field"><label>تاریخ پیگیری بعدی</label><input id="f_next" type="date" value="${c ? c.nextFollowup || '' : ''}"></div>
    <div class="field"><label>توضیحات</label><textarea id="f_notes">${c ? c.notes || '' : ''}</textarea></div>
    <div class="btn-row">
      <button class="btn btn-primary" id="saveCust">${c ? 'ذخیره تغییرات' : 'افزودن مشتری'}</button>
      ${c ? '<button class="btn btn-danger" id="delCust">حذف</button>' : ''}
    </div>
  `);
  
  document.getElementById('saveCust').addEventListener('click', async () => {
    const customer = {
      id: c ? c.id : uid(),
      name: document.getElementById('f_name').value.trim(),
      phone: document.getElementById('f_phone').value.trim(),
      address: document.getElementById('f_address').value.trim(),
      service: document.getElementById('f_service').value.trim(),
      source: document.getElementById('f_source').value,
      status: document.getElementById('f_status').value,
      nextFollowup: document.getElementById('f_next').value,
      notes: document.getElementById('f_notes').value.trim(),
      createdAt: c ? c.createdAt : todayISO(),
      lastNotified: c ? c.lastNotified : null
    };
    
    const success = await enhancedSaveCustomer(customer);
    if(success){
      closeSheet();
      render();
    }
  });
  
  if(c){
    document.getElementById('delCust').addEventListener('click', async () => {
      if(!confirm('حذف این مشتری؟ این عمل قابل بازگشت نیست.')) return;
      await enhancedDeleteCustomer(c.id);
      closeSheet();
      render();
    });
  }
}
'''

# Replace the three functions
# Pattern for renderCustomers
pattern1 = r'function renderCustomers\(\)\{[\s\S]*?(?=\nfunction renderCustList)'
content = re.sub(pattern1, new_render_customers, content)

# Pattern for renderCustList
pattern2 = r'function renderCustList\(q\)\{[\s\S]*?(?=\nfunction openCustomerForm)'
content = re.sub(pattern2, new_render_cust_list, content)

# Pattern for openCustomerForm
pattern3 = r'function openCustomerForm\(id\)\{[\s\S]*?(?=\n\n// ================= ORDERS)'
content = re.sub(pattern3, new_open_customer_form, content)

# Write back
with open('/data/data/com.termux/files/home/ojwin-crm/index.html', 'w', encoding='utf-8') as f:
    f.write(content)

print('✅ توابع با موفقیت جایگزین شدند')
