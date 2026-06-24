const mongoose = require('mongoose');

const orderSchema = new mongoose.Schema({
  userId: {
    type: String,
    required: true
  },
  items: [{
    id: String,
    title: String,
    price: Number,
    qty: Number
  }],
  tickets: [{
    ticketId: String,
    event: String,
    qrCode: String,
    used: { type: Boolean, default: false },
    usedAt: Date
  }],
  total: {
    type: Number,
    required: true
  },
  paymentStatus: {
    type: String,
    enum: ['pending', 'completed', 'failed', 'mpesa_pending'],
    default: 'pending'
  },
  paymentMethod: String,
  paidAt: Date,
  splitAmount: Number,
  mainAmount: Number,
  paystackRef: String,
  createdAt: {
    type: Date,
    default: Date.now
  },
  commission: {
  type: Number,
  default: 0
},
netAmount: {
  type: Number,
  default: 0
}
,
emailed: {
  type: Boolean,
  default: false
}
});

module.exports = mongoose.model('Order', orderSchema);
