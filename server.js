require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const { initializeDatabase } = require('./database/db');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Serve uploaded documents
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

app.use('/api/auth',          require('./routes/auth'));
app.use('/api/organizations', require('./routes/organizations'));
app.use('/api/compliance',    require('./routes/compliance'));
app.use('/api/incidents',     require('./routes/incidents'));
app.use('/api/events',        require('./routes/events'));
app.use('/api/roster',        require('./routes/roster'));
app.use('/api/documents',     require('./routes/documents'));
app.use('/api/analytics',     require('./routes/analytics'));
app.use('/api/notifications', require('./routes/notifications'));

app.use('/api/*', (req, res) => res.status(404).json({ error: 'API route not found' }));

// Catch-all: serve 404 page for any unmatched route
app.use((req, res) => {
  res.status(404).sendFile(path.join(__dirname, 'public', '404.html'));
});

initializeDatabase().then(() => {
  app.listen(PORT, () => {
    console.log(`\n  GreekPath running at http://localhost:${PORT}\n`);
  });
}).catch(err => {
  console.error('Failed to initialize database:', err.message);
  process.exit(1);
});
