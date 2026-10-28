import { useEffect, useState } from 'react';
import api from '../../api/client';
import type { Question } from '../../api/types';
import { useToast } from '../../context/ToastContext';
import { getErrorMessage } from '../../utils/errors';

export default function Questions() {
  const toast = useToast();
  const [items, setItems] = useState<Question[]>([]);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      const { data } = await api.get('/questions/unanswered');
      setItems(data);
    } catch {
      toast.error('Could not load questions');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function submitAnswer(id: string) {
    const answer = String(answers[id] || '').trim();
    if (answer.length < 2) {
      toast.error('Answer is required');
      return;
    }
    try {
      await api.patch(`/questions/${id}/answer`, { answer });
      toast.success('Answer posted');
      setAnswers((prev) => ({ ...prev, [id]: '' }));
      await load();
    } catch (err) {
      toast.error(getErrorMessage(err, 'Could not save answer'));
    }
  }

  return (
    <div>
      <h1>Product Q&A</h1>
      <p className="muted">Answer customer questions about catalog products.</p>
      {loading && <p className="muted">Loading…</p>}
      {!loading && !items.length && <p className="muted">No unanswered questions.</p>}
      <div className="order-list">
        {items.map((row) => (
          <article key={row._id} className="order-card">
            <p className="muted">
              {typeof row.product === 'object' && row.product?.name ? row.product.name : 'Product'}
            </p>
            <p>
              <strong>{row.userName}:</strong> {row.question}
            </p>
            <label>
              Your answer
              <textarea
                className="input"
                rows={2}
                value={answers[row._id] || ''}
                onChange={(e) => setAnswers({ ...answers, [row._id]: e.target.value })}
              />
            </label>
            <button type="button" className="btn btn-primary" onClick={() => submitAnswer(row._id)}>
              Post answer
            </button>
          </article>
        ))}
      </div>
    </div>
  );
}
