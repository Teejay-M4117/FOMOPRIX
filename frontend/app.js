// Force wait for QR library
window.addEventListener('load', () => {
  console.log('QRCode library status:', typeof QRCode);
});
const api = '/api';
let token = localStorage.getItem('token');
let currentUser = token ? JSON.parse(localStorage.getItem('currentUser') || '{}') : null;
let events = [];
const cart = [];
let currentOrder = null;

// DOM elements
const emailEl = document.getElementById('email');
const passwordEl = document.getElementById('password');
const loginBtn = document.getElementById('login');
const registerBtn = document.getElementById('register');
const logoutBtn = document.getElementById('logout');
const checkoutBtn = document.getElementById('checkout');
const eventsEl = document.getElementById('events');
const cartEl = document.getElementById('cart-items');
const totalEl = document.getElementById('total');
const paymentDetails = document.getElementById('payment-details');
const ordersList = document.getElementById('orders-list');
const userEmail = document.getElementById('user-email');
const mpesaPhoneEl = document.getElementById('mpesa-phone');
const submitMpesaBtn = document.getElementById('submit-mpesa');
const backToOrdersBtn = document.getElementById('back-to-orders');
const backToShopBtn = document.getElementById('back-to-shop');
const backFromAdminBtn = document.getElementById('back-from-admin');
const myOrdersBtn = document.getElementById('my-orders');
const adminBtn = document.getElementById('admin-btn');
const adminToolsBtn = document.getElementById('admin-tools-btn');
const headerScannerBtn = document.getElementById('header-scanner-btn');
const adminOpenScannerBtn = document.getElementById('admin-open-scanner');

// Basic auth handlers (minimal)
async function loginUser() {
  try {
    const email = emailEl?.value;
    const password = passwordEl?.value;
    const res = await fetch(`${api}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    const data = await res.json();
    if (data.token) {
      token = data.token;
      currentUser = data.user;
      localStorage.setItem('token', token);
      localStorage.setItem('currentUser', JSON.stringify(currentUser));
      initApp();
    } else {
      alert(data.error || 'Login failed');
    }
  } catch (e) { console.error(e); alert('Login error'); }
}

async function registerUser() {
  try {
    const email = emailEl?.value;
    const password = passwordEl?.value;
    const res = await fetch(`${api}/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    const data = await res.json();
    alert(data.message || data.error || 'Registered');
  } catch (e) { console.error(e); alert('Register error'); }
}

function logoutUser() {
  token = null;
  currentUser = null;
  localStorage.removeItem('token');
  localStorage.removeItem('currentUser');
  location.reload();
}

async function initApp() {
  showPage('main-page');
  if (userEmail && currentUser) userEmail.textContent = currentUser.email;
  await loadEvents();
}

// Load events from backend and render
async function loadEvents() {
  try {
    const res = await fetch(`${api}/events`);
    events = await res.json();
    renderEvents(events);
  } catch (e) {
    console.error('Failed to load events', e);
    events = [];
    renderEvents([]);
  }
}

function renderEvents(list) {
  if (!eventsEl) return;
  eventsEl.innerHTML = '';
  if (!list || list.length === 0) {
    eventsEl.innerHTML = '<p style="color:#fff;">No events available.</p>';
    return;
  }

  list.forEach(ev => {
    const card = document.createElement('div');
    card.className = 'card';
    card.innerHTML = `
      <img src="${ev.image || 'https://via.placeholder.com/300x200'}" alt="${ev.title}" />
      <div style="padding:12px;">
        <h3>${ev.title}</h3>
        <div class="event-date">${ev.date || ''}</div>
        <p>${ev.description || ''}</p>
        <p style="font-weight:700;">KES ${ev.price || 0}</p>
        <button class="add-to-cart">Add to cart</button>
      </div>
    `;

    const btn = card.querySelector('.add-to-cart');
    btn.addEventListener('click', () => addToCart(ev));
    // If admin, add delete button
    if (currentUser && currentUser.role === 'admin') {
      const del = document.createElement('button');
      del.style.marginLeft = '8px';
      del.textContent = 'Delete';
      del.addEventListener('click', () => {
        if (!confirm('Delete this event?')) return;
        deleteEvent(ev._id || ev.id);
      });
      btn.insertAdjacentElement('afterend', del);
    }
    eventsEl.appendChild(card);
  });
}

function addToCart(ev) {
  const existing = cart.find(c => c.id === ev._id || c.id === ev.id);
  if (existing) existing.qty += 1;
  else cart.push({ id: ev._id || ev.id, title: ev.title, price: ev.price || 0, qty: 1 });
  renderCart();
}

function removeFromCart(id) {
  const idx = cart.findIndex(c => c.id === id);
  if (idx >= 0) cart.splice(idx, 1);
  renderCart();
}

function renderCart() {
  if (!cartEl) return;
  cartEl.innerHTML = '';
  cart.forEach(item => {
    const li = document.createElement('li');
    li.innerHTML = `<span>${item.title} x${item.qty}</span><span>KES ${item.price * item.qty}</span>`;
    const rem = document.createElement('button');
    rem.className = 'remove-btn';
    rem.textContent = '×';
    rem.addEventListener('click', () => removeFromCart(item.id));
    li.appendChild(rem);
    cartEl.appendChild(li);
  });
  updateTotal();
}

function updateTotal() {
  const total = cart.reduce((s, i) => s + (i.price || 0) * (i.qty || 0), 0);
  if (totalEl) totalEl.textContent = `Total: KES ${total}`;
}


// Simple page/modal helpers used by index.html buttons
function showPage(pageId) {
  const pages = ['auth-page','main-page','payment-page','orders-page','admin-page'];
  pages.forEach(p => {
    const el = document.getElementById(p);
    if (el) el.classList.add('hidden');
  });
  const target = document.getElementById(pageId);
  if (target) target.classList.remove('hidden');
  // Toggle user menu visibility when authenticated
  const userMenu = document.getElementById('user-menu');
  if (userMenu) {
    if (currentUser && currentUser.email && pageId !== 'auth-page') {
      userMenu.classList.remove('hidden');
      // show admin controls if admin
      const adminB = document.getElementById('admin-btn');
      const adminToolsB = document.getElementById('admin-tools-btn');
      const headerScanB = document.getElementById('header-scanner-btn');
      if (currentUser.role === 'admin') {
        if (adminB) adminB.classList.remove('hidden');
        if (adminToolsB) adminToolsB.classList.remove('hidden');
        if (headerScanB) headerScanB.classList.remove('hidden');
      } else {
        if (adminB) adminB.classList.add('hidden');
        if (adminToolsB) adminToolsB.classList.add('hidden');
        if (headerScanB) headerScanB.classList.add('hidden');
      }
    } else userMenu.classList.add('hidden');
  }
}

function showModal(id) {
  const el = document.getElementById(id);
  if (el) el.classList.remove('hidden');
}

window.showModal = showModal;

function hideModal(id) {
  const el = document.getElementById(id);
  if (el) el.classList.add('hidden');
}

window.hideModal = hideModal;

// Wire additional buttons if present
if (submitMpesaBtn) {
  // Repurposed button: initiate Paystack flow (open authorization_url) then poll order
  submitMpesaBtn.addEventListener('click', async () => {
    if (!currentOrder || !currentOrder._id) {
      alert('No order to pay for. Please create an order first.');
      return;
    }

    try {
      const res = await fetch(`${api}/paystack/initialize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ orderId: currentOrder._id })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        console.error('Paystack init response error', res.status, data);
        alert(data.error || data.message || 'Failed to start payment');
        document.getElementById('payment-message').textContent = data.error || data.message || JSON.stringify(data);
        return;
      }

      // Open Paystack authorization URL in a new tab/window (or handle demo)
      if (data.authorization_url) {
        window.open(data.authorization_url, '_blank');
        document.getElementById('payment-message').textContent = 'Payment opened. Please complete payment in the Paystack window.';
      } else if (data.demo) {
        document.getElementById('payment-message').textContent = data.message || 'Demo payment started';
      } else {
        document.getElementById('payment-message').textContent = 'Payment started';
      }

      // Poll for order completion
      const paidOrder = await pollOrderStatus(currentOrder._id, 2000, 40);
      if (paidOrder && paidOrder.paymentStatus === 'completed') {
        try {
          // Show tickets immediately in a modal so user can download now
          displayTicketsModal(paidOrder);
          // Send email in background (idempotent)
          sendTicketsEmail(paidOrder._id).catch(e => console.error('Background email failed', e));
          // clear cart and return to shop
          cart.length = 0; renderCart();
        } catch (e) {
          console.error('Failed to handle tickets after payment:', e);
          alert('Payment succeeded but showing tickets failed.');
        }
      } else {
        // Polling timed out. Attempt server-side verification (uses Paystack secret on server).
        try {
          const verifyRes = await fetch(`${api}/paystack/verify-order`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify({ orderId: currentOrder._id })
          });
          const verifyData = await verifyRes.json().catch(() => ({}));
          if (verifyRes.ok && verifyData.verified) {
            // fetch fresh order
            const freshRes = await fetch(`${api}/orders/${currentOrder._id}`, { headers: { 'Authorization': `Bearer ${token}` } });
            if (freshRes.ok) {
              const freshOrder = await freshRes.json();
              if (freshOrder.paymentStatus === 'completed') {
                displayTicketsModal(freshOrder);
                sendTicketsEmail(freshOrder._id).catch(e => console.error('Background email failed', e));
                cart.length = 0; renderCart();
              } else {
                alert('Payment not completed yet. Check Paystack or try again.');
              }
            } else {
              alert('Payment verified but failed to fetch order. Please refresh and check your orders.');
            }
          } else {
            alert(verifyData.error || verifyData.message || 'Payment not completed within the expected time. Check Paystack or try again.');
          }
        } catch (e) {
          console.error('Verify-order call failed', e);
          alert('Payment not completed within the expected time. Check Paystack or try again.');
        }
      }
    } catch (e) {
      console.error('Paystack init error', e);
      document.getElementById('payment-message').textContent = `Payment request failed: ${e.message || e}`;
      alert('Payment request failed: ' + (e.message || e));
    }
  });
}

if (backToOrdersBtn) backToOrdersBtn.addEventListener('click', () => showPage('main-page'));
if (backToShopBtn) backToShopBtn.addEventListener('click', () => showPage('main-page'));
if (backFromAdminBtn) backFromAdminBtn.addEventListener('click', () => showPage('main-page'));
if (myOrdersBtn) { try { myOrdersBtn.style.display = 'none'; } catch(e){} }

if (adminBtn) adminBtn.addEventListener('click', () => showPage('admin-page'));
if (adminBtn) adminBtn.addEventListener('click', async () => { showPage('admin-page'); await loadAdminData(); });
if (adminToolsBtn) adminToolsBtn.addEventListener('click', () => showModal('admin-tools-modal'));

// Admin tools handlers
function showAdminTools() { showModal('admin-tools-modal'); }

// Scanner modal open — require admin
function openScannerModal(){
  if (!currentUser || currentUser.role !== 'admin'){
    alert('Admin access required to open the scanner');
    return;
  }
  // ensure iframe src is set (in case of navigation)
  const iframe = document.getElementById('scanner-iframe');
  if (iframe && !iframe.src) iframe.src = 'scanner.html';
  showModal('scanner-modal');
}

if (headerScannerBtn) headerScannerBtn.addEventListener('click', openScannerModal);
if (adminOpenScannerBtn) adminOpenScannerBtn.addEventListener('click', ()=>{ hideModal('admin-tools-modal'); openScannerModal(); });

async function showCreateEventForm() {
  const title = prompt('Event title:');
  if (!title) return alert('Title required');
  const price = parseFloat(prompt('Price (KES):', '1000') || '0');
  const date = prompt('Date (YYYY-MM-DD):', '2026-06-30');
  const image = prompt('Image URL (optional):', 'https://via.placeholder.com/800x450');
  const description = prompt('Short description:', 'Event description');

  try {
    const res = await fetch(`${api}/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ title, price, date, image, description })
    });
    const data = await res.json();
    if (res.ok) {
      alert('Event created');
      hideModal('admin-tools-modal');
      loadEvents();
    } else alert(data.error || JSON.stringify(data));
  } catch (e) { console.error(e); alert('Failed to create event'); }
}

async function showFreeTicketForm() {
  const userId = prompt('User ID to issue free ticket to:');
  if (!userId) return alert('User ID required');
  const title = prompt('Ticket title (event):', 'Free Ticket');
  const qty = parseInt(prompt('Quantity:', '1') || '1');
  try {
    const items = [{ title, price: 0, qty }];
    const res = await fetch(`${api}/admin/free-ticket`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ userId, items })
    });
    const data = await res.json();
    if (res.ok) { alert('Free ticket issued'); hideModal('admin-tools-modal'); }
    else alert(data.error || JSON.stringify(data));
  } catch (e) { console.error(e); alert('Failed to issue free ticket'); }
}

// Poll order status until completed or timeout
async function pollOrderStatus(orderId, interval = 2000, attempts = 30) {
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(`${api}/orders/${orderId}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        const order = await res.json();
        if (order.paymentStatus === 'completed') return order;
      }
    } catch (e) { console.error('poll error', e); }
    await new Promise(r => setTimeout(r, interval));
  }
  return null;
}

// Attach listeners safely
if (loginBtn) loginBtn.addEventListener('click', loginUser);
if (registerBtn) registerBtn.addEventListener('click', registerUser);
if (logoutBtn) logoutBtn.addEventListener('click', logoutUser);
if (checkoutBtn) {
  checkoutBtn.onclick = async () => {
    const res = await fetch(`${api}/orders`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ items: cart })
    });

    const data = await res.json();
    if (data.success) {
      currentOrder = data.order;
      showPaymentPage(data.order);
    }
  };
}

function showPaymentPage(order){
  paymentDetails.innerHTML = `
    <p>Order: ${order._id}</p>
    <p>KES ${order.total}</p>
  `;
  showPage('payment-page');
}

/* ================= ORDERS ================= */
async function loadMyOrders(){
  console.log('My Orders feature removed; tickets are emailed to users.');
  return [];
}

/* Orders UI removed: users receive tickets by email. */
function renderMyOrders(orders){
  alert('Orders view removed. Tickets are emailed to your account. Please check your email for tickets.');
  showPage('main-page');
}

/* ================= QR CODE ================= */
function generateQRCodeClient(data, container) {
  if (typeof QRCode === 'undefined') {
    console.error('QRCode library not loaded');
    container.innerHTML = '<span style="color:red;">QR Load Failed</span>';
    return;
  }

  container.innerHTML = '';   // clear previous

  new QRCode(container, {
    text: data,
    width: 200,
    height: 200,
    colorDark: "#000000",
    colorLight: "#ffffff",
    correctLevel: QRCode.CorrectLevel.H
  });
}

/* ================= REAL QR CODE ================= */
async function generateQRCodeClient(data, imgElement) {
  if (typeof QRCode === 'undefined') {
    console.error('QRCode library not loaded');
    imgElement.src = 'https://via.placeholder.com/200x200/cccccc/000000?text=QR+Not+Loaded';
    return;
  }

  try {
    const url = await QRCode.toDataURL(data, {
      width: 200,
      margin: 1,
      color: { dark: '#000000', light: '#FFFFFF' }
    });
    imgElement.src = url;
  } catch (err) {
    console.error('QR Code generation failed:', err);
    imgElement.src = 'https://via.placeholder.com/200x200/ff0000/ffffff?text=QR+Error';
  }
}

/* ================= DOWNLOAD ================= */
async function downloadTicket(orderId, ticketId, eventTitle) {
  const qrData = JSON.stringify({
    ticketId: ticketId,
    event: eventTitle,
    valid: true
  });

  const canvas = document.createElement('canvas');
  canvas.width = 400;
  canvas.height = 600;

  const ctx = canvas.getContext('2d');

  // Background
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, 400, 600);

  // Text
  ctx.fillStyle = '#000';
  ctx.font = 'bold 24px Arial';
  ctx.fillText(eventTitle, 50, 80);

  ctx.font = '18px Arial';
  ctx.fillText(`Order: ${orderId}`, 50, 120);
  ctx.fillText(`Ticket: ${ticketId}`, 50, 150);

  try {
    // Try preferred API first
    let url = null;
    if (typeof QRCode !== 'undefined' && QRCode.toDataURL) {
      try { url = await QRCode.toDataURL(qrData, { width: 220 }); } catch (e) { url = null; }
    }

    // Fallback: create a temporary QR node and extract image/svg
    if (!url) {
      const tmp = document.createElement('div');
      tmp.style.position = 'fixed'; tmp.style.left = '-9999px'; tmp.style.top = '0';
      document.body.appendChild(tmp);
      try {
        // Some QR libs render <img> or <svg>
        new QRCode(tmp, { text: qrData, width: 220, height: 220 });
        const imgEl = tmp.querySelector('img');
        if (imgEl && imgEl.src) url = imgEl.src;
        else {
          const svg = tmp.querySelector('svg');
          if (svg) {
            const svgStr = new XMLSerializer().serializeToString(svg);
            url = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgStr);
          }
        }
      } catch (e) {
        console.error('Fallback QR generation failed', e);
      } finally { tmp.remove(); }
    }

    if (!url) throw new Error('QR generation failed');

    const img = new Image();
    img.onload = () => {
      ctx.drawImage(img, 90, 200, 220, 220);

      // Add footer
      ctx.font = '14px Arial';
      ctx.fillText('Powered by Fomoprix • Valid for one use', 40, 550);

      canvas.toBlob(blob => {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `ticket-${ticketId}.png`;
        a.click();
        URL.revokeObjectURL(a.href);
      });
    };
    img.onerror = (e) => { console.error('QR image load failed', e); alert('Could not generate ticket image'); };
    img.src = url;
  } catch (err) {
    console.error('Failed to generate QR for download:', err);
    alert('Could not generate ticket image');
  }
}

/* ================= START ================= */
// Only auto-init when we have a valid currentUser with an email.
if (token && currentUser && currentUser.email) {
  initApp();
} else {
  // Clear any stale auth artifacts and show login page
  localStorage.removeItem('token');
  localStorage.removeItem('currentUser');
  token = null;
  currentUser = null;
  // ensure auth page is visible
  try { showPage('auth-page'); } catch (e) { /* safe fallback */ }
}

// Send tickets to user's email via backend endpoint
async function sendTicketsEmail(orderId) {
  if (!token) throw new Error('Not authenticated');
  const res = await fetch(`${api}/orders/email-tickets`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
    body: JSON.stringify({ orderId })
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || data.message || 'Failed to send tickets');
  // Show message to user
  if (data.demo && data.emailBody) {
    alert('Demo email logged.\n\n' + data.message + '\n\n' + data.emailBody);
  } else if (data.message) {
    alert(data.message);
  }
  return data;
}

// Show tickets UI for a single order (useful when emails are demo-logged)
function showOrderTickets(order) {
  try {
    if (!order) return;
    displayTicketsModal(order);
  } catch (e) { console.error('showOrderTickets error', e); }
}

// Display tickets in a modal with QR and download buttons
function displayTicketsModal(order) {
  try {
    const existing = document.getElementById('tickets-modal-auto');
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.id = 'tickets-modal-auto';
    modal.style.position = 'fixed';
    modal.style.left = '0';
    modal.style.top = '0';
    modal.style.width = '100%';
    modal.style.height = '100%';
    modal.style.background = 'rgba(0,0,0,0.6)';
    modal.style.display = 'flex';
    modal.style.alignItems = 'center';
    modal.style.justifyContent = 'center';
    modal.style.zIndex = 2000;

    const box = document.createElement('div');
    box.style.width = 'min(900px, 96%)';
    box.style.maxHeight = '90%';
    box.style.overflow = 'auto';
    box.style.background = '#fff';
    box.style.padding = '18px';
    box.style.borderRadius = '8px';

    const title = document.createElement('h3');
    title.textContent = `Your Tickets — Order ${order._id}`;
    box.appendChild(title);

    (order.tickets || []).forEach((t, i) => {
      const card = document.createElement('div');
      card.style.display = 'flex';
      card.style.alignItems = 'center';
      card.style.gap = '12px';
      card.style.margin = '12px 0';
      card.style.padding = '12px';
      card.style.border = '1px solid #ddd';
      card.style.borderRadius = '8px';

      const qrContainer = document.createElement('div');
      qrContainer.style.width = '180px';
      qrContainer.style.height = '180px';
      qrContainer.id = `modal-qr-${order._id}-${t.ticketId}`;
      card.appendChild(qrContainer);

      const info = document.createElement('div');
      info.style.flex = '1';
      info.innerHTML = `<div><strong>${t.event || 'Event'}</strong></div><div>Ticket: ${t.ticketId}</div>`;
      card.appendChild(info);

      const dl = document.createElement('button');
      dl.textContent = 'Download';
      dl.className = 'download-btn';
      dl.addEventListener('click', () => downloadTicket(order._id, t.ticketId, t.event || 'Event'));
      card.appendChild(dl);

      box.appendChild(card);

      // generate QR
      setTimeout(() => {
        try {
          const qrData = JSON.stringify({ ticketId: t.ticketId, event: t.event || 'Event', valid: true, orderId: order._id });
          const container = document.getElementById(`modal-qr-${order._id}-${t.ticketId}`);
          if (container) {
            container.innerHTML = '';
            new QRCode(container, { text: qrData, width: 180, height: 180 });
          }
        } catch (e) { console.error('Modal QR gen error', e); }
      }, 50);
    });

    const close = document.createElement('button');
    close.textContent = 'Close';
    close.style.marginTop = '12px';
    close.addEventListener('click', () => modal.remove());
    box.appendChild(close);

    modal.appendChild(box);
    document.body.appendChild(modal);
  } catch (e) { console.error('displayTicketsModal error', e); }
}

// Load admin stats and recent orders into admin page
async function loadAdminData() {
  try {
    const res = await fetch(`${api}/admin/stats`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!res.ok) {
      console.error('Failed to load admin stats');
      return;
    }
    const data = await res.json();
    const statsEl = document.getElementById('admin-stats');
    const ordersEl = document.getElementById('admin-orders');
    if (statsEl) {
      statsEl.innerHTML = `
        <div class="stat-box"><p><strong>Total Orders:</strong> ${data.totalOrders}</p></div>
        <div class="stat-box"><p><strong>Total Sales:</strong> KES ${data.totalSales}</p></div>
        <div class="stat-box"><p><strong>Total Users:</strong> ${data.totalUsers}</p></div>
        <div class="stat-box"><p><strong>Total Events:</strong> ${data.totalEvents}</p></div>
      `;
    }
    if (ordersEl) {
      ordersEl.innerHTML = '';
      (data.orders || []).forEach(o => {
        const div = document.createElement('div');
        div.className = 'order-row';
        div.innerHTML = `<div>#${o._id}</div><div>KES ${o.total} • ${o.paymentStatus}</div>`;
        ordersEl.appendChild(div);
      });
    }
    // load help requests
    try {
      const hr = await fetch(`${api}/admin/help-requests`, { headers: { 'Authorization': `Bearer ${token}` } });
      if (hr.ok) {
        const help = await hr.json();
        const helpEl = document.getElementById('admin-help-requests');
        if (helpEl) {
          helpEl.innerHTML = '';
          help.forEach(h => {
            const box = document.createElement('div');
            box.className = 'stat-box';
            box.innerHTML = `<p><strong>${h.subject}</strong> — ${h.email}</p><p>${h.message}</p>`;
            const replyBtn = document.createElement('button');
            replyBtn.textContent = 'Reply';
            replyBtn.style.marginTop = '8px';
            replyBtn.addEventListener('click', async () => {
              const response = prompt('Reply to user:');
              if (!response) return;
              const r = await fetch(`${api}/admin/help-requests/${h._id}/reply`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                body: JSON.stringify({ response })
              });
              if (r.ok) { alert('Replied'); loadAdminData(); }
              else { alert('Reply failed'); }
            });
            box.appendChild(replyBtn);
            helpEl.appendChild(box);
          });
        }
      }
    } catch (e) { console.error('Failed loading help requests', e); }
  } catch (e) { console.error('loadAdminData error', e); }
}

// Delete an event (admin)
async function deleteEvent(eventId) {
  if (!eventId) return;
  try {
    const res = await fetch(`${api}/events/${eventId}`, { method: 'DELETE', headers: { 'Authorization': `Bearer ${token}` } });
    const data = await res.json();
    if (res.ok) { alert('Event deleted'); loadEvents(); }
    else alert(data.error || 'Failed to delete');
  } catch (e) { console.error(e); alert('Delete failed'); }
}

// Change password prompt + API call
function showChangePasswordModal() {
  if (!token) return alert('Login required');
  const oldPwd = prompt('Current password:');
  if (!oldPwd) return alert('Old password required');
  const newPwd = prompt('New password:');
  if (!newPwd) return alert('New password required');
  fetch(`${api}/change-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
    body: JSON.stringify({ oldPassword: oldPwd, newPassword: newPwd })
  }).then(async r => {
    const d = await r.json();
    if (r.ok) alert(d.message || 'Password changed');
    else alert(d.error || 'Change failed');
  }).catch(e => {
  console.error(e);
  alert('Error changing password');
});
}
