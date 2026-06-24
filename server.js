const express = require('express');
const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5000;
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/fomoprix';

// Global error handlers to prevent process from exiting on unhandled errors
process.on('unhandledRejection', (reason, p) => {
  console.error('Unhandled Rejection at Promise', p, 'reason:', reason);
});

process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception thrown:', err);
  // Do not exit the process; log and allow it to continue for development
});

process.on('warning', (warning) => {
  console.warn('Node warning:', warning.name, warning.message);
});

// Models
const User = require('./models/User');
const Event = require('./models/Event');
const Order = require('./models/Order');
const HelpRequest = require('./models/HelpRequest');
const nodemailer = require('nodemailer');
const QRCode = require('qrcode');

// Helper: send tickets email for an order (idempotent)
async function sendTicketsForOrder(order, userEmail) {
  try {
    if (!order) return;
    if (order.emailed) return;
    const ticketLines = (order.tickets || []).map(t => `- ${t.event}: ${t.ticketId}`).join('\n');
    const body = `Hello ${userEmail || ''},\n\nHere are your tickets for order ${order._id}:\n\n${ticketLines}\n\nThank you for using Fomoprix.`;
    // Build HTML body including inline QR images if available
    const htmlLines = [`<p>Hello ${userEmail || ''},</p>`, `<p>Here are your tickets for order ${order._id}:</p>`, '<ul>'];
    const attachments = [];
    (order.tickets || []).forEach((t, idx) => {
      const cid = `${t.ticketId}@fomoprix`;
      if (t.qrCode && t.qrCode.startsWith('data:image')) {
        // convert data URL to buffer
        const matches = t.qrCode.match(/^data:([A-Za-z-+/]+);base64,(.+)$/);
        if (matches) {
          const mime = matches[1];
          const b64 = matches[2];
          const buf = Buffer.from(b64, 'base64');
          attachments.push({ filename: `${t.ticketId}.png`, content: buf, cid });
          htmlLines.push(`<li>${t.event}: ${t.ticketId}<br/><img src="cid:${cid}" style="max-width:200px;height:auto;"/></li>`);
        } else {
          htmlLines.push(`<li>${t.event}: ${t.ticketId}</li>`);
        }
      } else {
        htmlLines.push(`<li>${t.event}: ${t.ticketId}</li>`);
      }
    });
    htmlLines.push('<p>Thank you for using Fomoprix.</p>');
    const htmlBody = htmlLines.join('\n');

    if (process.env.SMTP_HOST && process.env.SMTP_USER) {
      const smtpHost = process.env.SMTP_HOST;
      const smtpUser = process.env.SMTP_USER;
      const smtpPass = process.env.SMTP_PASS;
      const smtpFrom = process.env.SMTP_FROM || smtpUser;
      const smtpPort = parseInt(process.env.SMTP_PORT || '587');
      const smtpSecure = process.env.SMTP_SECURE === 'true';

      const mailOptions = { from: smtpFrom, to: userEmail, subject: `Your Fomoprix Tickets - Order ${order._id}`, text: body, html: htmlBody, attachments };

      // Helper to create transporter and send
      async function sendWithConfig(cfg) {
        const transporter = nodemailer.createTransport(cfg);
        return transporter.sendMail(mailOptions);
      }

      try {
        // Try primary configuration first
        await sendWithConfig({ host: smtpHost, port: smtpPort, secure: smtpSecure, auth: { user: smtpUser, pass: smtpPass } });
        order.emailed = true;
        await order.save();
        console.log(`📧 Tickets emailed to ${userEmail} for order ${order._id}`);
        return { success: true, message: 'Tickets emailed' };
      } catch (errPrimary) {
        console.warn('Primary email send failed, attempting STARTTLS fallback (port 587, secure=false):', errPrimary && (errPrimary.message || errPrimary));
        try {
          // Fallback: explicit STARTTLS on port 587 (secure: false)
          await sendWithConfig({ host: smtpHost, port: 587, secure: false, auth: { user: smtpUser, pass: smtpPass }, tls: { rejectUnauthorized: false } });
          order.emailed = true;
          await order.save();
          console.log(`📧 Tickets emailed to ${userEmail} for order ${order._id} (via STARTTLS fallback)`);
          return { success: true, message: 'Tickets emailed (fallback)' };
        } catch (errFallback) {
          console.error('sendTicketsForOrder error (fallback):', errFallback);
          // As a last resort, log a demo email body so tickets are visible in logs
          try {
            console.warn('Falling back to demo email logging and marking order as emailed.');
            console.log('📧 Demo auto-email to:', userEmail);
            console.log(body);
            order.emailed = true;
            await order.save();
            return { success: true, demo: true, message: 'Fallback: demo email logged to server console', emailBody: body };
          } catch (finalErr) {
            console.error('Final fallback failed while logging demo email:', finalErr);
            return { success: false, error: finalErr && (finalErr.message || String(finalErr)) };
          }
        }
      }
    } else {
      console.log('📧 Demo auto-email to:', userEmail);
      console.log(body);
      order.emailed = true;
      await order.save();
      return { success: true, demo: true, message: 'Demo email logged to server console', emailBody: body };
    }
  } catch (err) {
    console.error('sendTicketsForOrder error:', err);
    return { success: false, error: err.message };
  }
}

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'frontend')));

// MongoDB Connection
mongoose.connect(MONGODB_URI)
.then(() => {
  console.log('✅ MongoDB connected');
  initializeDefaultData();
})
.catch(err => {
  console.error('❌ MongoDB connection error:', err.message);
  process.exit(1);
});

// Initialize default data (admin user, sample events)
async function initializeDefaultData() {
  try {
    console.log('🔍 Initializing default data...');
    
    // Skip if admin already exists
    const adminExists = await User.findOne({ email: 'admin@ticketing.com' }).catch(e => null);
    if (adminExists) {
      console.log('✅ Admin user already exists');
    } else {
      try {
        const admin = new User({
          email: 'admin@ticketing.com',
          password: 'admin123',
          role: 'admin'
        });
        await admin.save();
        console.log('✅ Admin user created');
      } catch (err) {
        console.log('⚠️ Admin creation skipped:', err.message);
      }
    }

    // Skip if events already exist
    const eventCount = await Event.countDocuments().catch(e => 0);
    if (eventCount > 0) {
      console.log('✅ Events already exist');
    } else {
      try {
        const sampleEvents = [
          {
            id: '1',
            title: 'Indie Music Night',
            price: 2000,
            image: 'https://images.unsplash.com/photo-1506152983158-6f5a8a6a7f6b?q=80&w=800&auto=format&fit=crop&crop=entropy',
            date: '2026-03-15',
            description: 'Live indie music performances'
          },
          {
            id: '2',
            title: 'Food Festival',
            price: 1500,
            image: 'https://images.unsplash.com/photo-1504674900247-0877df9cc836?q=80&w=800&auto=format&fit=crop&crop=entropy',
            date: '2026-03-20',
            description: 'Taste cuisines from around the world'
          },
          {
            id: '3',
            title: 'Tech Conference',
            price: 9900,
            image: 'https://images.unsplash.com/photo-1526378721300-2e3f3b7a1f4a?q=80&w=800&auto=format&fit=crop&crop=entropy',
            date: '2026-04-01',
            description: 'Latest in technology and innovation'
          }
        ];
        await Event.insertMany(sampleEvents);
        console.log('✅ Sample events created');
      } catch (err) {
        console.log('⚠️ Events creation skipped:', err.message);
      }
    }
  } catch (err) {
    console.log('⚠️ Initialization warning:', err.message);
  }
}

// Auth Routes
app.post('/api/register', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password required' });
    }

    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ error: 'User already exists' });
    }

    const user = new User({ email, password, role: 'user' });
    await user.save();
    res.json({ success: true, message: 'Registered successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email });
    
    if (!user) {
      console.log(`❌ Login failed for ${email}`);
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const isPasswordValid = await user.comparePassword(password);
    if (!isPasswordValid) {
      console.log(`❌ Login failed for ${email} - wrong password`);
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = Buffer.from(JSON.stringify({ 
      id: user._id.toString(), 
      email: user.email, 
      role: user.role 
    })).toString('base64');
    
    console.log(`✅ Login successful: ${email} (ID: ${user._id})`);
    res.json({ 
      token, 
      user: { 
        id: user._id.toString(), 
        email: user.email, 
        role: user.role 
      } 
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Password Reset Routes
app.post('/api/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email required' });

    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) return res.status(404).json({ error: 'User not found' });

    // Generate 6-digit reset code
    const resetCode = Math.floor(100000 + Math.random() * 900000).toString();
    user.resetCode = resetCode;
    user.resetExpires = new Date(Date.now() + 15 * 60000); // 15 minutes
    await user.save();

    console.log(`📧 Password reset code for ${email}: ${resetCode}`);
    res.json({ 
      success: true, 
      message: 'Reset code sent to email (Demo: ' + resetCode + ')' 
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/reset-password', async (req, res) => {
  try {
    const { email, code, newPassword } = req.body;
    if (!email || !code || !newPassword) {
      return res.status(400).json({ error: 'Email, code, and password required' });
    }

    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (user.resetCode !== code) return res.status(400).json({ error: 'Invalid code' });
    if (user.resetExpires < new Date()) return res.status(400).json({ error: 'Code expired' });

    user.password = newPassword;
    user.resetCode = null;
    user.resetExpires = null;
    await user.save();

    console.log(`✅ Password reset successful for ${email}`);
    res.json({ success: true, message: 'Password reset successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/change-password', checkAuth, async (req, res) => {
  try {
    const { oldPassword, newPassword } = req.body;
    if (!oldPassword || !newPassword) {
      return res.status(400).json({ error: 'Old and new password required' });
    }

    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const isValid = await user.comparePassword(oldPassword);
    if (!isValid) return res.status(400).json({ error: 'Wrong password' });

    user.password = newPassword;
    await user.save();

    console.log(`✅ Password changed for user: ${req.user.email}`);
    res.json({ success: true, message: 'Password changed successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Event Routes
app.get('/api/events', async (req, res) => {
  try {
    const events = await Event.find();
    res.json(events);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/events/:id', async (req, res) => {
  try {
    const event = await Event.findById(req.params.id);
    if (!event) return res.status(404).json({ error: 'Event not found' });
    res.json(event);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Auth Middleware
function checkAuth(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  try {
    req.user = JSON.parse(Buffer.from(token, 'base64').toString('utf8'));
    next();
  } catch (e) {
    res.status(401).json({ error: 'Invalid token' });
  }
}

// Admin Event Management Routes
app.post('/api/events', checkAuth, async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Admin only' });
    }
    const { title, price, image, date, description } = req.body;
    if (!title || !price || !date) {
      return res.status(400).json({ error: 'Title, price, and date required' });
    }
    const newEvent = new Event({
      id: `EVT-${Date.now()}`,
      title,
      price,
      image: image || 'https://via.placeholder.com/300x200?text=' + encodeURIComponent(title),
      date,
      description: description || ''
    });
    await newEvent.save();
    console.log(`✅ Event created: ${title}`);
    res.json({ success: true, event: newEvent });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/events/:id', checkAuth, async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Admin only' });
    }
    const { title, price, image, date, description } = req.body;
    const event = await Event.findByIdAndUpdate(
      req.params.id,
      { title, price, image, date, description },
      { new: true }
    );
    if (!event) return res.status(404).json({ error: 'Event not found' });
    console.log(`✅ Event updated: ${title}`);
    res.json({ success: true, event });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/events/:id', checkAuth, async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Admin only' });
    }
    const event = await Event.findByIdAndDelete(req.params.id);
    if (!event) return res.status(404).json({ error: 'Event not found' });
    console.log(`✅ Event deleted: ${event.title}`);
    res.json({ success: true, message: 'Event deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Admin Help Request Routes
app.get('/api/admin/help-requests', checkAuth, async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Admin only' });
    }
    const helpRequests = await HelpRequest.find().sort({ createdAt: -1 });
    res.json(helpRequests);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/admin/help-requests/:id/reply', checkAuth, async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Admin only' });
    }
    const { response } = req.body;
    if (!response) {
      return res.status(400).json({ error: 'Response required' });
    }
    const helpRequest = await HelpRequest.findByIdAndUpdate(
      req.params.id,
      { response, status: 'responded' },
      { new: true }
    );
    if (!helpRequest) return res.status(404).json({ error: 'Help request not found' });
    console.log(`✅ Help request responded: ${helpRequest.subject}`);
    res.json({ success: true, helpRequest });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Order Routes
app.post('/api/orders', checkAuth, async (req, res) => {
  try {
    const order = req.body;
    if (!order || !Array.isArray(order.items) || order.items.length === 0) {
      return res.status(400).json({ error: 'Empty order' });
    }

    // Generate tickets with QR codes (server-side PNG data URLs)
    const tickets = [];
    for (const item of order.items) {
      for (let i = 0; i < item.qty; i++) {
        const ticketId = `TKT-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        // Create a payload for the QR (can be validated later)
        const payload = JSON.stringify({ ticketId, orderRef: null });
        // Generate data URL PNG for the ticket
        let dataUrl = null;
        try {
          dataUrl = await QRCode.toDataURL(ticketId, { type: 'image/png' });
        } catch (qrErr) {
          console.error('QR generation failed for', ticketId, qrErr);
          dataUrl = null;
        }

        tickets.push({
          ticketId,
          event: item.title,
          qrCode: dataUrl // data:image/png;base64,... or null
        });
      }
    }

    const newOrder = new Order({
      userId: req.user.id,
      items: order.items,
      tickets,
      total: order.items.reduce((sum, item) => sum + item.price * item.qty, 0),
      // Orders are created pending payment; payment completed by MPesa/Paystack flow
      paymentStatus: 'pending'
    });

    await newOrder.save();
    res.json({ success: true, order: newOrder });

    // If order is free (total 0), mark as completed and email tickets immediately
    if (newOrder.total === 0) {
      try {
        newOrder.paymentStatus = 'completed';
        newOrder.paymentMethod = 'free';
        newOrder.paidAt = new Date();
        await newOrder.save();
        // find user email
        const user = await User.findById(newOrder.userId).catch(() => null);
        const userEmail = user ? user.email : req.user.email;
        await sendTicketsForOrder(newOrder, userEmail);
      } catch (e) { console.error('Auto-complete/email for free order failed:', e); }
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/orders', checkAuth, async (req, res) => {
  try {
    console.log(`📦 Fetching orders for user: ${req.user.id} (role: ${req.user.role})`);
    let orders;
    if (req.user.role === 'admin') {
      orders = await Order.find();
      console.log(`✅ Admin viewing all ${orders.length} orders`);
    } else {
      orders = await Order.find({ userId: req.user.id });
      console.log(`✅ User ${req.user.id} viewing ${orders.length} orders`);
    }

    res.json(orders);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/orders/:id', checkAuth, async (req, res) => {
  try {
    const order = await Order.findById(req.params.id);
    if (!order) return res.status(404).json({ error: 'Order not found' });
    
    if (order.userId !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Forbidden' });
    }
    res.json(order);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Admin Stats
app.get('/api/admin/stats', checkAuth, async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Admin only' });
    }

    const totalOrders = await Order.countDocuments();
   const revenueStats = await Order.aggregate([
  {
    $group: {
      _id: null,
      totalSales: { $sum: '$total' },
      totalCommission: { $sum: '$commission' },
      totalNet: { $sum: '$netAmount' }
    }
  }
]);
    const totalUsers = await User.countDocuments();
    const totalEvents = await Event.countDocuments();
    const orders = await Order.find().sort({ createdAt: -1 }).limit(10);

   res.json({
  totalOrders,
  totalSales: revenueStats[0]?.totalSales || 0,
  totalCommission: revenueStats[0]?.totalCommission || 0,
  totalNet: revenueStats[0]?.totalNet || 0,
  totalUsers,
  totalEvents,
  orders
});
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Admin Free Ticket Route
app.post('/api/admin/free-ticket', checkAuth, async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Admin only' });
    }

    const { userId, items } = req.body;
    if (!userId || !items || items.length === 0) {
      return res.status(400).json({ error: 'User ID and items required' });
    }

    // Generate tickets with QR codes
    const tickets = [];
    for (const item of items) {
      for (let i = 0; i < item.qty; i++) {
        const ticketId = `TKT-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        tickets.push({
          ticketId,
          event: item.title,
          qrCode: null // Will be generated client-side
        });
      }
    }

    const newOrder = new Order({
      userId,
      items,
      tickets,
      total: 0,
      paymentStatus: 'completed',
      paymentMethod: 'admin-free'
    });

    await newOrder.save();
    console.log(`✅ Free ticket issued for user ${userId} by admin`);
    res.json({ success: true, message: 'Free ticket issued', order: newOrder });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Download Ticket
app.get('/api/tickets/:orderId/download', checkAuth, async (req, res) => {
  try {
    const order = await Order.findById(req.params.orderId);
    if (!order) return res.status(404).json({ error: 'Order not found' });

    if (order.userId !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Forbidden' });
    }

    // Return ticket data for frontend to generate download
    res.json({
      success: true,
      tickets: order.tickets,
      orderInfo: {
        orderId: order._id,
        total: order.total,
        paymentStatus: order.paymentStatus,
        paidAt: order.paidAt,
        items: order.items
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Help/Contact Form
app.post('/api/help/submit', async (req, res) => {
  try {
    const { name, email, subject, message } = req.body;
    if (!name || !email || !subject || !message) {
      return res.status(400).json({ error: 'All fields required' });
    }

    const HelpRequest = require('./models/HelpRequest');
    const helpRequest = new HelpRequest({ name, email, subject, message });
    await helpRequest.save();

    console.log(`📧 Help request from ${email}: ${subject}`);
    res.json({ success: true, message: 'Help request submitted successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get Terms & Conditions
app.get('/api/terms', (req, res) => {
  const termsText = `TERMS AND CONDITIONS

Welcome to Fomoprix Ticketing Platform

1. ACCEPTANCE OF TERMS
By using this platform, you accept and agree to be bound by these terms and conditions.

2. USER ACCOUNTS
- You are responsible for maintaining the confidentiality of your account
- You agree to provide accurate information during registration
- You are responsible for all activities under your account

3. TICKETS
- Tickets are non-transferable and valid only for the specified event
- Digital tickets are unique and linked to your account
- Displaying QR codes from other accounts is prohibited
- Tickets cannot be resold or used for commercial purposes

4. PAYMENTS
- All prices are displayed in Kenyan Shillings (KES)
- M-Pesa is the accepted payment method
- Refunds are subject to our refund policy
- Payment is non-refundable unless event is cancelled

5. EVENTS
- Event dates and times are subject to change
- No refunds for personal reasons
- Fomoprix reserves the right to cancel or postpone events

6. LIABILITY
- Fomoprix is not liable for lost or forgotten tickets
- Users must ensure QR codes are not shared publicly
- Lost devices with digital tickets are user responsibility

7. INTELLECTUAL PROPERTY
- All content, logos, and branding are property of Fomoprix
- Unauthorized use is prohibited

8. AMENDMENTS
- We reserve the right to modify these terms anytime
- Continued use constitutes acceptance of changes

For assistance, contact our support team at support@fomoprix.com`;

  res.json({
    success: true,
    terms: termsText,
    version: '1.0',
    lastUpdated: new Date('2024-01-01')
  });
});

// M-Pesa Payment (via Paystack)
app.post('/api/mpesa/stkpush', checkAuth, async (req, res) => {
  try {
    const { orderId, phone } = req.body;
    if (!orderId || !phone) {
      return res.status(400).json({ error: 'Order ID and phone number required' });
    }

    // Normalize phone number - convert to 254XXXXXXXXX format
    let normalizedPhone = phone.replace(/\s/g, ''); // Remove spaces
    if (normalizedPhone.startsWith('0')) {
      normalizedPhone = '254' + normalizedPhone.substring(1); // 07xx -> 2547xx
    } else if (normalizedPhone.startsWith('+')) {
      normalizedPhone = normalizedPhone.substring(1); // +2547xx -> 2547xx
    } else if (!normalizedPhone.startsWith('254')) {
      normalizedPhone = '254' + normalizedPhone; // Assume it needs 254 prefix
    }

    // Validate phone format
    if (!/^254\d{9}$/.test(normalizedPhone)) {
      return res.status(400).json({ error: 'Invalid phone number format. Use format like 0712345678, +254712345678, or 254712345678' });
    }

    const order = await Order.findOne({ _id: orderId, userId: req.user.id });
    if (!order) return res.status(404).json({ error: 'Order not found' });

    const USE_REAL_MPESA = process.env.MPESA_ENABLED === 'true';
    const splitPercent = parseFloat(process.env.REVENUE_SPLIT_PERCENT || 5) / 100;
    const splitAmount = Math.round(order.total * splitPercent);
    const mainAmount = order.total - splitAmount;

    if (USE_REAL_MPESA) {
      // Integrate Paystack for M-Pesa
      const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY;
      if (!PAYSTACK_SECRET_KEY) {
        return res.status(500).json({ error: 'Paystack integration not configured' });
      }

      try {
        const paystackRes = await fetch('https://api.paystack.co/charge', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${PAYSTACK_SECRET_KEY}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            amount: order.total * 100, // Paystack expects amount in kobo (KES * 100)
            email: req.user.email,
            currency: 'KES',
            mobile_money: {
              phone: normalizedPhone, // Use normalized format
              provider: 'mpesa'
            },
            metadata: {
              orderId: order._id.toString(),
              userId: req.user.id
            }
          })
        });

        const paystackData = await paystackRes.json();
        if (!paystackRes.ok) {
          console.error('Paystack error:', paystackData);
          return res.status(400).json({ error: paystackData.message || 'Paystack error' });
        }

        if (paystackData.status && paystackData.data.status === 'success') {
          // Payment successful
          order.paymentStatus = 'completed';
          order.paymentMethod = 'mpesa';
          order.paidAt = new Date();
          order.splitAmount = splitAmount;
          order.mainAmount = mainAmount;
          order.paystackRef = paystackData.data.reference;
          await order.save();

          // Send tickets to user after successful payment
          try { await sendTicketsForOrder(order, req.user.email); } catch (emailErr) { console.error('Auto-email after MPesa success failed:', emailErr); }

          res.json({
            success: true,
            mode: 'production',
            message: 'Payment processed via Paystack M-Pesa',
            phone,
            amount: order.total,
            mainAmount,
            splitAmount,
            currency: 'KES',
            orderId: order._id,
            paystackRef: paystackData.data.reference
          });
        } else if (paystackData.status && paystackData.data.status === 'pending') {
          // Payment pending (user needs to authorize)
          order.paymentStatus = 'mpesa_pending';
          order.paystackRef = paystackData.data.reference;
          await order.save();

          res.json({
            success: true,
            mode: 'production',
            message: 'M-Pesa prompt sent. Please check your phone.',
            phone,
            amount: order.total,
            mainAmount,
            splitAmount,
            currency: 'KES',
            orderId: order._id,
            paystackRef: paystackData.data.reference
          });
        } else {
          res.status(400).json({ error: paystackData.message || 'Payment failed' });
        }
      } catch (paystackErr) {
        console.error('Paystack API error:', paystackErr);
        res.status(500).json({ error: 'Payment service error' });
      }
    } else {
      // Demo mode
      order.paymentStatus = 'mpesa_pending';
      await order.save();

      res.json({
        success: true,
        mode: 'demo',
        message: 'Demo mode: M-Pesa transaction will complete in 5 seconds',
        phone,
        amount: order.total,
        mainAmount,
        splitAmount,
        currency: 'KES',
        orderId: order._id
      });

      setTimeout(async () => {
        try {
          order.paymentStatus = 'completed';
          order.paymentMethod = 'mpesa';
          order.paidAt = new Date();
          order.splitAmount = splitAmount;
          order.mainAmount = mainAmount;
          await order.save();
          console.log(`✅ Demo: M-Pesa payment completed for order ${order._id}`);
          console.log(`   💰 Main amount (95%): KES ${mainAmount}`);
          console.log(`   📤 Split amount (5%): KES ${splitAmount} → ${process.env.SPLIT_MPESA_ACCOUNT || 'mpesa-split'}`);
          // send tickets email (demo or real) to user who created the order
          try { await sendTicketsForOrder(order, req.user.email); } catch(e){ console.error('Auto-email after MPesa demo failed', e); }
        } catch (err) {
          console.error('Error completing M-Pesa payment:', err);
        }
      }, 5000);
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Paystack transaction initialize (for Paystack-only flow)
app.post('/api/paystack/initialize', checkAuth, async (req, res) => {
  try {
    const { orderId } = req.body || {};
    if (!orderId) return res.status(400).json({ error: 'orderId required' });

    const order = await Order.findOne({ _id: orderId, userId: req.user.id });
    if (!order) return res.status(404).json({ error: 'Order not found' });

    console.log(`🔔 Paystack init requested for order ${orderId} by user ${req.user?.email || req.user?.id}`);

    const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY;
    if (!PAYSTACK_SECRET_KEY) {
      // Demo fallback: simulate a payment process and complete after a short delay
      order.paymentStatus = 'pending';
      await order.save();
      // start demo completion
      setTimeout(async () => {
        try {
          order.paymentStatus = 'completed';
          order.paymentMethod = 'paystack-demo';
          order.paidAt = new Date();
          await order.save();
          console.log(`✅ Demo Paystack payment completed for order ${order._id}`);
          // send tickets to user automatically
          try { await sendTicketsForOrder(order, req.user.email); } catch(e){ console.error('Auto-email after Paystack demo failed', e); }
        } catch (err) { console.error('Demo Paystack completion error', err); }
      }, 4000);

      return res.json({ success: true, demo: true, message: 'Demo Paystack flow started (will complete shortly)' });
    }

    const initRes = await fetch('https://api.paystack.co/transaction/initialize', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${PAYSTACK_SECRET_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        amount: Math.round(order.total * 100),
        email: req.user.email,
        currency: 'KES',
        metadata: { orderId: order._id.toString(), userId: req.user.id }
      })
    });

    const initData = await initRes.json();
    if (!initRes.ok) {
      console.error('Paystack initialize error:', initData);
      return res.status(400).json({ error: initData.message || 'Paystack error', details: initData });
    }

    // Save reference to the order so we can verify later
    order.paystackRef = initData.data.reference;
    order.paymentStatus = 'pending';
    await order.save();

    // Return authorization_url and reference to frontend
    res.json({ success: true, authorization_url: initData.data.authorization_url, reference: initData.data.reference });
  } catch (err) {
    console.error('Paystack init error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Force verify a Paystack transaction for an order and email tickets if successful
app.post('/api/paystack/verify-order', checkAuth, async (req, res) => {
  try {
    const { orderId, reference } = req.body || {};

    if (!orderId && !reference) return res.status(400).json({ error: 'orderId or reference required' });

    const order = orderId ? await Order.findById(orderId) : null;
    if (orderId && !order) return res.status(404).json({ error: 'Order not found' });
    if (order && order.userId !== req.user.id && req.user.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });

    const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY;
    if (!PAYSTACK_SECRET_KEY) return res.status(400).json({ error: 'Paystack not configured on server' });

    const refToVerify = order?.paystackRef || reference;
    if (!refToVerify) return res.status(400).json({ error: 'Order has no Paystack reference. Pass `reference` in request body.' });

    // Call Paystack verify
    console.log(`🔎 Verifying paystack ref ${refToVerify} for order ${order?._id || '(no-order-provided)'}`);
    const verifyRes = await fetch(`https://api.paystack.co/transaction/verify/${refToVerify}`, {
      headers: { 'Authorization': `Bearer ${PAYSTACK_SECRET_KEY}` }
    });
    const verifyData = await verifyRes.json().catch(() => ({}));
    if (!verifyRes.ok) {
      console.error('Paystack verify failed:', verifyData);
      return res.status(400).json({ error: verifyData.message || 'Paystack verify failed', details: verifyData });
    }
    if (verifyData.data && verifyData.data.status === 'success') {
      // If we don't have an order object yet, try to locate it from Paystack metadata
      if (!order) {
        try {
          const meta = verifyData.data.metadata || {};
          if (meta.orderId) {
            order = await Order.findById(meta.orderId).catch(() => null);
          }
          // Fallback: find a recent pending order for the userId in metadata
          if (!order && meta.userId) {
            order = await Order.findOne({ userId: meta.userId, paymentStatus: { $in: ['pending','mpesa_pending'] } }).sort({ createdAt: -1 }).catch(() => null);
          }
          // Another fallback: try to match by amount (Paystack amount is in kobo)
          if (!order && verifyData.data.amount) {
            const amountKES = verifyData.data.amount / 100;
            order = await Order.findOne({ total: amountKES, paymentStatus: { $in: ['pending','mpesa_pending'] } }).sort({ createdAt: -1 }).catch(() => null);
          }
        } catch (findErr) {
          console.error('Error while trying to locate order from Paystack metadata:', findErr);
        }
      }

      if (order) {
        // attach reference if missing
        if (!order.paystackRef) order.paystackRef = refToVerify;
        order.paymentStatus = 'completed';
        order.paymentMethod = 'paystack';
        order.paidAt = new Date();
        await order.save();
        try { await sendTicketsForOrder(order, req.user.email); } catch (emailErr) { console.error('Auto-email error during verify-order:', emailErr); }
      } else {
        console.log('ℹ️ Paystack reference verified but no matching order found; skipping email.');
      }

      return res.json({ success: true, verified: true, message: 'Payment verified and tickets emailed (if configured)'});
    }

    res.json({ success: false, verified: false, status: verifyData.data?.status || 'unknown', details: verifyData });
  } catch (err) {
    console.error('verify-order error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Paystack webhook receiver: completes order when Paystack notifies of success
// Verifies signature (HMAC SHA512) if PAYSTACK_SECRET_KEY is set
app.post('/api/paystack/webhook', express.json(), async (req, res) => {
  try {
    const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY;
    const signatureHeader = req.headers['x-paystack-signature'] || req.headers['X-Paystack-Signature'];
    if (PAYSTACK_SECRET_KEY && signatureHeader) {
      const crypto = require('crypto');
      const hmac = crypto.createHmac('sha512', PAYSTACK_SECRET_KEY).update(JSON.stringify(req.body)).digest('hex');
      if (hmac !== signatureHeader) {
        console.warn('Paystack webhook: invalid signature');
        return res.status(401).send('Invalid signature');
      }
    }

    const event = req.body;
    // handle charge success events
    if (event && (event.event === 'charge.success' || event.event === 'transaction.success' || event.event === 'charge.completed' || (event.data && event.data.status === 'success'))) {
      const data = event.data || {};
      const reference = data.reference || data.tx_ref || null;
      // Try metadata.orderId first
      const metaOrderId = data.metadata?.orderId || data.metadata?.orderID || null;

      let order = null;
      if (metaOrderId) {
        order = await Order.findById(metaOrderId).catch(() => null);
      }
      if (!order && reference) {
        order = await Order.findOne({ paystackRef: reference }).catch(() => null);
      }
      if (!order && data.amount) {
        const amountKES = data.amount / 100;
        order = await Order.findOne({ total: amountKES, paymentStatus: { $in: ['pending','mpesa_pending'] } }).sort({ createdAt: -1 }).catch(() => null);
      }

      if (order) {
        if (order.paymentStatus === 'completed') {
          console.log(`ℹ️ Paystack webhook: order ${order._id} already completed`);
          return res.json({ success: true, message: 'Already completed' });
        }

        order.paystackRef = order.paystackRef || reference;
        order.paymentStatus = 'completed';
        order.paymentMethod = 'paystack';
        order.paidAt = new Date();
        await order.save();

        // send tickets (idempotent)
        try {
          const user = await User.findById(order.userId).catch(() => null);
          const userEmail = user ? user.email : (data.customer?.email || data.customer_email || null);
          await sendTicketsForOrder(order, userEmail);
        } catch (emailErr) {
          console.error('Paystack webhook: error sending tickets', emailErr);
        }

        console.log(`✅ Paystack webhook processed order ${order._id}`);
        return res.json({ success: true });
      } else {
        console.log('ℹ️ Paystack webhook: no matching order found for reference', reference);
        return res.json({ success: false, message: 'Order not found' });
      }
    }

    // For other events, acknowledge
    res.json({ success: true, received: true });
  } catch (err) {
    console.error('Paystack webhook error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Temporary: force-complete an order and email tickets (owner or admin)
app.post('/api/orders/force-complete', checkAuth, async (req, res) => {
  try {
    const { orderId } = req.body || {};
    if (!orderId) return res.status(400).json({ error: 'orderId required' });
    const order = await Order.findById(orderId);
    if (!order) return res.status(404).json({ error: 'Order not found' });
    if (order.userId !== req.user.id && req.user.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });

    order.paymentStatus = 'completed';
    order.paymentMethod = order.paymentMethod || 'force-complete';
    order.paidAt = new Date();
    await order.save();

    // send tickets
    try {
      const user = await User.findById(order.userId).catch(() => null);
      const userEmail = user ? user.email : req.user.email;
      const sendRes = await sendTicketsForOrder(order, userEmail);
      return res.json({ success: true, message: 'Order force-completed', email: sendRes });
    } catch (e) {
      console.error('Force-complete email error', e);
      return res.status(500).json({ error: 'Order completed but emailing failed', details: e.message });
    }
  } catch (err) {
    console.error('force-complete error', err);
    res.status(500).json({ error: err.message });
  }
});

// Validate a ticket (mark as used). Admin only.
app.post('/api/tickets/validate', checkAuth, async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
    const { ticketId } = req.body || {};
    if (!ticketId) return res.status(400).json({ error: 'ticketId required' });

    // Find the order containing this ticket
    const order = await Order.findOne({ 'tickets.ticketId': ticketId });
    if (!order) return res.status(404).json({ error: 'Ticket not found' });

    const ticket = order.tickets.find(t => t.ticketId === ticketId);
    if (!ticket) return res.status(404).json({ error: 'Ticket not found' });
    if (ticket.used) return res.json({ success: false, used: true, message: 'Ticket already used', usedAt: ticket.usedAt });

    ticket.used = true;
    ticket.usedAt = new Date();
    await order.save();

    console.log(`✅ Ticket ${ticketId} validated (order ${order._id}) by ${req.user.email}`);
    res.json({ success: true, used: true, message: 'Ticket validated' });
  } catch (err) {
    console.error('Ticket validate error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Email tickets to user (demo if SMTP not configured)
app.post('/api/orders/email-tickets', checkAuth, async (req, res) => {
  try {
    const { orderId } = req.body || {};
    let order = null;
    if (orderId) order = await Order.findById(orderId);
    else order = await Order.findOne({ userId: req.user.id }).sort({ createdAt: -1 });

    if (!order) return res.status(404).json({ error: 'Order not found' });
    if (order.userId !== req.user.id && req.user.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });

    const ticketLines = (order.tickets || []).map(t => `- ${t.event}: ${t.ticketId}`).join('\n');
    const body = `Hello ${req.user.email},\n\nHere are your tickets for order ${order._id}:\n\n${ticketLines}\n\nThank you for using Fomoprix.`;

    // If already emailed, return idempotent success
    if (order.emailed) return res.json({ success: true, message: 'Tickets already emailed' });

    // If SMTP configured, send real email
    if (process.env.SMTP_HOST && process.env.SMTP_USER) {
      const transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: parseInt(process.env.SMTP_PORT || '587'),
        secure: process.env.SMTP_SECURE === 'true',
        auth: {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASS
        }
      });

      await transporter.sendMail({
        from: process.env.SMTP_FROM || process.env.SMTP_USER,
        to: req.user.email,
        subject: `Your Fomoprix Tickets - Order ${order._id}`,
        text: body
      });

      order.emailed = true;
      await order.save();
      console.log(`📧 Tickets emailed to ${req.user.email} for order ${order._id}`);
      return res.json({ success: true, message: 'Tickets emailed' });
    }

    // Demo fallback: log the email on the server and return success (include body for local viewing)
    console.log('📧 Demo email to:', req.user.email);
    console.log(body);
    order.emailed = true;
    await order.save();
    return res.json({ success: true, demo: true, message: 'Demo email logged to server console', emailBody: body });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`✅ Server running on http://localhost:${PORT}`);
});
