const express = require('express');
const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5000;
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/fomoprix';

// Models
const User = require('./models/User');
const Event = require('./models/Event');
const Order = require('./models/Order');

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
            title: 'blackout',
            price: 2000,
            image: 'https://via.placeholder.com/300x200?text=Blackout',
            date: '2026-04-18',
            description: 'Operation Blackout'
          },
          {
            id: '2',
            title: 'Food Festival',
            price: 1500,
            image: 'https://via.placeholder.com/300x200?text=Food+Festival',
            date: '2026-03-20',
            description: 'Taste cuisines from around the world'
          },
          {
            id: '3',
            title: 'Tech Conference',
            price: 9900,
            image: 'https://via.placeholder.com/300x200?text=Tech+Conf',
            date: '2026-04-01',
            description: 'Latest in technology and innovation'
          },
          {
            id: '4',
            title: 'blackout',
            price: 800,
            image: 'https://tse4.mm.bing.net/th/id/OIP.hJvD9S8jNngQQyz9NmNwQAHaE6?rs=1&pid=ImgDetMain&o=7&rm=3',
            date: '2026-04-18',
            description: 'Operation Blackout - Special event'
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

// Order Routes
app.post('/api/orders', checkAuth, async (req, res) => {
  try {
    const order = req.body;
    if (!order || !Array.isArray(order.items) || order.items.length === 0) {
      return res.status(400).json({ error: 'Empty order' });
    }

    // Generate tickets with QR codes
    const tickets = [];
    for (const item of order.items) {
      for (let i = 0; i < item.qty; i++) {
        const ticketId = `TKT-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        const svgQR = `<svg xmlns="http://www.w3.org/2000/svg" width="250" height="250" viewBox="0 0 250 250"><rect fill="white" width="250" height="250"/><g fill="black" opacity="0.8"><rect x="10" y="10" width="50" height="50"/><rect x="190" y="10" width="50" height="50"/><rect x="10" y="190" width="50" height="50"/><rect x="70" y="70" width="110" height="110" fill="none" stroke="black" stroke-width="2"/></g><text x="125" y="135" font-size="11" font-family="monospace" text-anchor="middle" dominant-baseline="middle" font-weight="bold">${ticketId.substr(0,20)}</text><text x="125" y="155" font-size="9" font-family="monospace" text-anchor="middle" fill="#666">${item.title}</text></svg>`;
        const qrCode = 'data:image/svg+xml;base64,' + Buffer.from(svgQR).toString('base64');
        tickets.push({
          ticketId,
          event: item.title,
          qrCode
        });
      }
    }

    const newOrder = new Order({
      userId: req.user.id,
      items: order.items,
      tickets,
      total: order.items.reduce((sum, item) => sum + item.price * item.qty, 0),
      paymentStatus: 'completed'
    });

    await newOrder.save();
    res.json({ success: true, order: newOrder });
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
      console.log(`📋 Found ${orders.length} orders for this user`);
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
    const totalRevenue = await Order.aggregate([
      { $group: { _id: null, total: { $sum: '$total' } } }
    ]);
    const totalUsers = await User.countDocuments();
    const totalEvents = await Event.countDocuments();
    const orders = await Order.find().sort({ createdAt: -1 }).limit(10);

    res.json({
      totalOrders,
      totalRevenue: totalRevenue[0]?.total || 0,
      totalUsers,
      totalEvents,
      orders
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Payment endpoint
app.post('/api/payment', checkAuth, async (req, res) => {
  try {
    const { orderId, amount, paymentMethod } = req.body;
    if (!orderId || !amount) {
      return res.status(400).json({ error: 'Order ID and amount required' });
    }

    const order = await Order.findOne({ _id: orderId, userId: req.user.id });
    if (!order) return res.status(404).json({ error: 'Order not found' });

    const success = Math.random() < 0.95;
    if (success) {
      order.paymentStatus = 'completed';
      order.paymentMethod = paymentMethod || 'card';
      order.paidAt = new Date();
      await order.save();
      res.json({
        success: true,
        message: 'Payment processed successfully',
        transactionId: `TXN-${Date.now()}`,
        order
      });
    } else {
      res.status(400).json({
        success: false,
        error: 'Payment failed. Please try again.'
      });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// M-Pesa STK Push
app.post('/api/mpesa/stkpush', checkAuth, async (req, res) => {
  try {
    const { orderId, phone } = req.body;
    if (!orderId || !phone) {
      return res.status(400).json({ error: 'Order ID and phone required' });
    }

    let formattedPhone = phone.replace(/\D/g, '');
    if (formattedPhone.startsWith('254')) {
      // Kenya format: 254712345678
    } else if (formattedPhone.startsWith('0')) {
      formattedPhone = '254' + formattedPhone.substring(1);
    } else if (formattedPhone.length === 9) {
      formattedPhone = '254' + formattedPhone;
    }

    if (!formattedPhone.startsWith('254') || formattedPhone.length < 12) {
      return res.status(400).json({ error: 'Invalid Kenya phone number' });
    }

    const order = await Order.findOne({ _id: orderId, userId: req.user.id });
    if (!order) return res.status(404).json({ error: 'Order not found' });

    const USE_REAL_MPESA = process.env.MPESA_ENABLED === 'true';

    if (USE_REAL_MPESA) {
      res.json({
        success: true,
        mode: 'production',
        message: 'M-Pesa STK push initiated',
        phone: formattedPhone,
        amount: order.total,
        currency: 'KES',
        orderId: order._id,
        instructions: 'Check your phone for the M-Pesa payment prompt'
      });
    } else {
      // DEMO MODE
      order.paymentStatus = 'mpesa_pending';
      await order.save();

      res.json({
        success: true,
        mode: 'demo',
        message: 'Demo mode: Payment will auto-complete in 5 seconds',
        phone: formattedPhone,
        amount: order.total,
        currency: 'KES',
        orderId: order._id
      });

      // Auto-complete after 5 seconds
      setTimeout(async () => {
        try {
          order.paymentStatus = 'completed';
          order.paymentMethod = 'mpesa';
          order.paidAt = new Date();
          await order.save();
          console.log(`✅ Demo: M-Pesa payment completed for order ${order._id}`);
        } catch (err) {
          console.error('Error completing M-Pesa payment:', err);
        }
      }, 5000);
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`✅ Server running on http://localhost:${PORT}`);
});
