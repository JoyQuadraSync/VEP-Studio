export function runCommentWorker(event: { event_id: string }) {
  console.log('Comment event received');
  return {
    event_id: event.event_id,
    worker: 'comment-worker',
    message: 'Event processed successfully'
  };
}
