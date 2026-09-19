import React from "react";

interface EmptyStateProps {
  onSelectPrompt: (prompt: string) => void;
}

export const EmptyState: React.FC<EmptyStateProps> = ({ onSelectPrompt }) => {
  const examplePrompts = [
    {
      title: "Core studio services",
      text: "What services does CloseFuture provide?",
      category: "Capabilities",
    },
    {
      title: "Case study insights",
      text: "Tell me about CloseFuture case studies like Dipy and Liya AI.",
      category: "Portfolio",
    },
    {
      title: "Schedule founder call",
      text: "Can I book a discovery call with the founder?",
      category: "Scheduling",
    },
  ];

  return (
    <div className="empty-state-container">
      <div className="empty-state-card">
        <div className="empty-state-icon">🚀</div>
        <h2 className="empty-state-heading">Welcome to CloseFuture</h2>
        <p className="empty-state-description">
          CloseFuture is an AI product studio that builds and launches web apps, mobile apps, and custom platforms in 4–6 weeks.
          Ask any question about our services, projects, or schedule a discovery call with our founder.
        </p>

        <div className="prompt-suggestions-grid">
          {examplePrompts.map((prompt, idx) => (
            <button
              key={idx}
              type="button"
              className="prompt-pill-card"
              onClick={() => onSelectPrompt(prompt.text)}
            >
              <div className="prompt-pill-header">
                <span className="prompt-pill-tag">{prompt.category}</span>
                <span className="prompt-pill-arrow">→</span>
              </div>
              <p className="prompt-pill-text">{prompt.text}</p>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};
