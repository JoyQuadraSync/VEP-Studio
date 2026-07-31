import express from 'express';
import { EventBus } from './event-bus/event-bus';
import { registerEventRouter } from './router/event.router';
import { eventSchema } from './schemas/event.schema';

const app = express();
const port = process.env.PORT || 3000;
const eventBus = new EventBus();

registerEventRouter(eventBus);

app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.post('/events', (req, res) => {
  const parseResult = eventSchema.safeParse(req.body);

  if (!parseResult.success) {
    return res.status(400).json({
      success: false,
      error: 'Validation failed',
      details: parseResult.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message
      }))
    });
  }

  const result = eventBus.publish(parseResult.data)[0];

  return res.status(result.statusCode).json(result.body);
});

app.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});

export default app;
