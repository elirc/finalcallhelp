import React, { useEffect, useRef, useState } from 'react';
import { PRACTICE_CATEGORIES, PracticeDeck, type PracticeCategory } from '../../shared/practice';

/**
 * Practice deck controls. Owns the deck so a category change reshuffles
 * without touching session state; the drawn question is handed up as text.
 */
export function PracticeCard({
  disabled,
  suggestedCategory,
  onQuestion,
}: {
  disabled: boolean;
  /** From the active profile's call type; adopted until the user deals a card. */
  suggestedCategory: PracticeCategory | 'all';
  onQuestion: (text: string) => void;
}): React.JSX.Element {
  const [category, setCategory] = useState<PracticeCategory | 'all'>(suggestedCategory);
  const deckRef = useRef<PracticeDeck | null>(null);
  const [dealtCount, setDealtCount] = useState(0);

  useEffect(() => {
    if (dealtCount === 0) setCategory(suggestedCategory);
  }, [suggestedCategory, dealtCount]);

  const changeCategory = (next: PracticeCategory | 'all') => {
    setCategory(next);
    deckRef.current = null;
    setDealtCount(0);
  };

  const draw = () => {
    if (!deckRef.current) deckRef.current = new PracticeDeck(category);
    const deck = deckRef.current;
    onQuestion(deck.draw().text);
    setDealtCount(deck.size - deck.remaining);
  };

  return (
    <section className="card">
      <h2>
        Practice
        {dealtCount > 0 && deckRef.current && (
          <span className="deck-progress" data-testid="practice-progress">
            {dealtCount} of {deckRef.current.size}
          </span>
        )}
      </h2>
      <div className="row">
        <select
          aria-label="practice category"
          value={category}
          onChange={(e) => changeCategory(e.target.value as PracticeCategory | 'all')}
          data-testid="practice-category"
          style={{ maxWidth: 220 }}
        >
          {PRACTICE_CATEGORIES.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </select>
        <button className="small" onClick={draw} disabled={disabled} data-testid="practice-draw">
          Draw a question
        </button>
      </div>
      <p className="hint">
        The question lands in “Heard” above — answer it aloud first, then press “Respond to edited
        text” to compare with a suggested response.
      </p>
    </section>
  );
}
