export const englishWorkflow = {
  title: 'LLM evaluation workflow',
  intro: 'Flywheel turns production failures into versioned regression tests and uses the results to control canary releases.',
  back: 'Back to overview',
  steps: {
    capture: {
      title: 'Capture production signals',
      paragraphs: [
        'Record prompts, responses, retrieved passages, tool calls, latency, token usage, and feedback. Mask PII before storage. By default, online evaluation samples 5% of traces without feedback and adds detected silent failures to Bad Case Analysis.'
      ],
      link: 'View traces'
    },
    curate: {
      title: 'Diagnose and curate failures',
      paragraphs: [
        'Group related failures to see which scenarios and versions are affected. Confirm the suggested root cause and correct the example. Add it to the regression suite or export it as a few-shot example, a knowledge base patch, or an SFT or DPO record.'
      ],
      link: 'Review bad cases'
    },
    iterate: {
      title: 'Test the fix in the Playground',
      paragraphs: [
        'Generate and review variants from corrected cases to test whether a fix generalizes. Keep training exports separate from the active evaluation set and save changes to the dataset as a new snapshot.',
        'Compare up to 10 cases side by side before registering a candidate. Playground Top-K limits the retrieval results already recorded in each trace.'
      ],
      link: 'Open Playground'
    },
    evaluate: {
      title: 'Run a reproducible regression',
      paragraphs: [
        'Compare the baseline and candidate on the same dataset snapshot. Run deterministic checks first, then score eligible outputs with an LLM judge. Use randomized blind A/B reviews to calibrate the judge. Each judged run records the judge model ID and prompt version.',
        'Critical cases run independently three times by default. The report shows how many attempts passed, the pass rate, and whether all planned attempts passed.',
        'Replay multi-turn sessions from recorded history and score agents on their tool trajectories. External runners can isolate tool calls with fixture-backed mocks or read-only sandboxes and declare their setup in toolIsolation.'
      ],
      link: 'View evaluation runs'
    },
    release: {
      title: 'Release through a canary',
      paragraphs: [
        'Run full regression in CI. Gate releases on quality, P95 latency, time to first token, and cost per call. Once enough live traffic has been observed, a breach of the dislike or error rate threshold routes traffic back to the baseline and records an alert. Feed canary traces into the next evaluation cycle.'
      ],
      link: 'View canary releases'
    }
  },
  setup: 'You can try the workflow with demo data. LLM judging and embedding-based clustering require server-side model configuration.'
};
