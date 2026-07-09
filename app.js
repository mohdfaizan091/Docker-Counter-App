import express from 'express';
const app = express();

let count = 0;

app.get('/count', (req, res) => {
  res.json({ count });
});

app.get('/increment', (req, res) => {
  count++;
  res.json({ count });
});

app.listen(3000, () => {
  console.log('App running on port 3000');
});