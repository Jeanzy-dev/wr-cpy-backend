import mongoose from 'mongoose';

const messageSchema = new mongoose.Schema({
  sender: { type: String, required: true },
  senderName: { type: String, default: '' }, // 👈 ¡Este campo es el que faltaba en el esquema!
  receiver: { type: String, required: true },
  content: { type: String, required: true },
  timestamp: { type: Date, required: true }
});

export const Message = mongoose.model('Message', messageSchema);