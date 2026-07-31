import express from 'express';
import eventRouter from './router/event.router';

const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.use(eventRouter);

app.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});

export default app;
