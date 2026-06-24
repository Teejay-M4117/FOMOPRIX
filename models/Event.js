const mongoose = require('mongoose');

const eventSchema = new mongoose.Schema({
  id: String,
  title: {
    type: String,
    required: true
  },
  price: {
    type: Number,
    required: true
  },
  image: String,
  date: String,
  description: String,
  createdAt: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model('Event', eventSchema);
