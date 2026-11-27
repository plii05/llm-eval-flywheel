import { isEnglish } from './i18n.js';
import { esc, hrefBtn, I, title } from './ui.js';
import { englishWorkflow } from './workflow.en.js';
import { chineseWorkflow } from './workflow.zh.js';

const stages = {
  capture: ['activity', 'traces', 'blue'],
  curate: ['bug', 'cases', 'amber'],
  iterate: ['bracket', 'playground', 'purple'],
  evaluate: ['flask', 'runs', 'coral'],
  release: ['rocket', 'releases', 'green']
};

export function workflow(pathFor) {
  const copy = isEnglish ? englishWorkflow : chineseWorkflow;
  return '<article class="workflow-guide">' + title(copy.title, copy.intro, hrefBtn(copy.back, 'grid', pathFor('overview'))) +
    '<ol class="workflow-guide-steps">' + Object.entries(stages).map(([key, [icon, dest, tone]]) => {
      const step = copy.steps[key];
      return '<li class="card workflow-guide-step"><span class="step-icon ' + tone + '">' + I(icon) + '</span>' +
        '<div><h2>' + esc(step.title) + '</h2>' + step.paragraphs.map(text => '<p>' + esc(text) + '</p>').join('') +
        '<a class="link" href="' + pathFor(dest) + '">' + esc(step.link) + I('arrow') + '</a></div></li>';
    }).join('') + '</ol><p class="workflow-guide-note">' + esc(copy.setup) + '</p></article>';
}
