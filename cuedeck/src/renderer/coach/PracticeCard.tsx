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
  /** From the active profile's call type; followed until the user picks a category. */
  suggestedCategory: PracticeCategory | 'all';
  onQuestion: (text: string) => void;
}): React.JSX.Element {
  // `explicit` records a category the user chose; after that, profile
  // switches no longer override it.
  const [choice, setChoice] = useState<{
    category: PracticeCategory | 'all';
    explicit: boolean;
  }>({ category: suggestedCategory, explicit: false });
  const category = choice.category;
  const deckRef = useRef<PracticeDeck | null>(null);
  const [dealtCount, setDealtCount] = useState(0);

  useEffect(() => {
    setChoice((prev) =>
      prev.explicit || prev.category === suggestedCategory
        ? prev
        : { category: suggestedCategory, explicit: false },
    );
  }, [suggestedCategory]);

  // A category that followed the profile reshuffles like a chosen one.
  useEffect(() => {
    deckRef.current = null;
    setDealtCount(0);
  }, [category]);

  const changeCategory = (next: PracticeCategory | 'all') => {
    setChoice({ category: next, explicit: true });
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
