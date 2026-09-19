import React from "react";

interface EmptyStateProps {
  onSelectPrompt: (prompt: string) => void;
}

export const EmptyState: React.FC<EmptyStateProps> = ({ onSelectPrompt }) => {
  return (
    <div className="cinematic-hero-wrapper">
      <div className="hero-content-block">
        {/* REFINED PRODUCT IDENTITY BADGE */}
        <div className="hero-product-badge">
          <span className="badge-sparkle">✦</span>
          <span>CloseFuture Studio Intelligence</span>
        </div>

        {/* LARGE EDITORIAL HEADLINE (64-76px) */}
        <h1 className="hero-headline">
          Build something<br />
          worth <span className="headline-gradient">shipping.</span>
        </h1>

        {/* SUPPORTING EDITORIAL COPY */}
        <p className="hero-supporting-copy">
          Explore CloseFuture’s services, case studies, and product expertise — or start a conversation about your next product.
        </p>

        {/* SOPHISTICATED COMMAND / ACTION SURFACE */}
        <div className="hero-actions-container">
          {/* PRIMARY ACCENTED ACTION: BOOKING */}
          <button
            type="button"
            className="hero-primary-action"
            onClick={() => onSelectPrompt("Can I book a discovery call with the founder?")}
          >
            <svg className="action-cal-svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
              <line x1="16" y1="2" x2="16" y2="6"/>
              <line x1="8" y1="2" x2="8" y2="6"/>
              <line x1="3" y1="10" x2="21" y2="10"/>
            </svg>
            <span className="action-text-bold">Book a Discovery Call</span>
            <span className="action-arrow-accent">→</span>
          </button>

          {/* SECONDARY EDITORIAL PROMPTS */}
          <div className="hero-secondary-actions-cluster">
            <button
              type="button"
              className="hero-pill-action"
              onClick={() => onSelectPrompt("What services does CloseFuture provide?")}
            >
              <span>Explore Services</span>
              <span className="pill-arrow">↗</span>
            </button>

            <button
              type="button"
              className="hero-pill-action"
              onClick={() => onSelectPrompt("Tell me about CloseFuture case studies like Dipy and Liya AI.")}
            >
              <span>Case Studies</span>
              <span className="pill-arrow">↗</span>
            </button>

            <button
              type="button"
              className="hero-pill-action"
              onClick={() => onSelectPrompt("I have a project idea and would like to discuss scoping, timeline, and tech stack.")}
            >
              <span>Discuss My Project</span>
              <span className="pill-arrow">↗</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
