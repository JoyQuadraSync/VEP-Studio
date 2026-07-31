import { Router, Request, Response } from 'express';
import { eventSchema } from '../schemas/event.schema';
import { runCommentWorker } from '../workers/comment.worker';

const router = Router();

router.post('/events', (req: Request, res: Response) => {
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

  const event = parseResult.data;

  if (event.event_type !== 'customer.comment.created') {
    return res.status(422).json({
      success: false,
      error: 'Unsupported event type'
    });
  }

  const result = runCommentWorker({ event_id: event.event_id });

  return res.status(200).json({
    success: true,
    event_id: result.event_id,
    worker: result.worker,
    message: result.message
  });
});

export default router;
