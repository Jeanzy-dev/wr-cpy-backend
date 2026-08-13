import mongoose from 'mongoose';

// Usa la variable de entorno si existe, o MongoDB local por defecto
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/whatsapp_db';

export const connectDB = async () => {
  try {
    await mongoose.connect(MONGO_URI);
    console.log(' Conexión exitosa a MongoDB');
  } catch (error) {
    console.error(' Error conectando a MongoDB:', error.message);
    process.exit(1); // Detiene la app si no se puede conectar a la BD
  }
};