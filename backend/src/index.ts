import express from 'express';
import { EventBus } from './event-bus/event-bus';
import { registerEventRouter } from './router/event.router';
import { eventSchema } from './schemas/event.schema';
import { registerAuditSubscriber } from './subscribers/audit.subscriber';
import { registerDelayedAuditSubscriber } from './subscribers/delayed-audit.subscriber';

const app = express();
const port = process.env.PORT || 3000;
const eventBus = new EventBus();

registerEventRouter(eventBus);
registerAuditSubscriber(eventBus);
registerDelayedAuditSubscriber(eventBus);

app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.post('/events', async (req, res) => {
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

  const results = await eventBus.publish(parseResult.data);
  const routerResult = results[0];

  if (!routerResult) {
    return res.status(500).json({
      success: false,
      error: 'No subscribers registered'
    });
  }

  return res.status(routerResult.statusCode).json(routerResult.body);
});

app.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});

export default app;
