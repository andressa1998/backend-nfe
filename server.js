require('dotenv').config();
const express = require('express');
const cors = require('cors');
const nfeRoutes = require('./nfeRoutes');

const app = express();
const PORT = process.env.PORT || 3000;

// Configuração CORS – permitir seu front-end na Vercel
const allowedOrigins = [
  'https://sistema-wheel-tech.vercel.app',   // substitua pelo domínio real
  'http://localhost:5501',
  'http://127.0.0.1:5501'
];

app.use(cors({
  origin: function (origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json({ limit: '50mb' }));
app.use('/nfe', nfeRoutes);

app.listen(PORT, () => {
  console.log(`🚀 Servidor NF-e rodando na porta ${PORT}`);
});