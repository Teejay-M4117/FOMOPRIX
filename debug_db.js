const mongoose = require('mongoose');
const User = require('./models/User');
const Order = require('./models/Order');
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/fomoprix';
(async () => {
  try {
    await mongoose.connect(MONGODB_URI);
    console.log('db connected');
    const users = await User.find();
    console.log('users', users.map(u => ({ id: u._id.toString(), email: u.email, role: u.role }))); 
    const orders = await Order.find().limit(20);
    console.log('orders', orders.map(o => ({ id: o._id.toString(), userId: o.userId, total: o.total, paymentStatus: o.paymentStatus, tickets: o.tickets?.length }))); 
    process.exit(0);
  } catch (err) {
    console.error('error', err);
    process.exit(1);
  }
})();