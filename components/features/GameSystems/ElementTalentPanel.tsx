import { useEffect, useRef, useState } from 'react';
import type { ComponentProps } from 'react';
import type { ElementId } from '@/models/teyvat/elements';
import { PathPanel } from './PathPanel';
import { SkillPanel } from './SkillPanel';

export interface ElementTalentPanelProps extends Omit<ComponentProps<typeof PathPanel>, 'browsedElement' | 'onBrowseElement'> {
  apiSettings?: ComponentProps<typeof SkillPanel>['apiSettings'];
  initialSection?: 'elements' | 'talents';
}

export function ElementTalentPanel({ traveler, onTravelerChange, apiSettings, initialSection = 'elements', ...elementState }: ElementTalentPanelProps) {
  const [browsedElement, setBrowsedElement] = useState<ElementId>(traveler.主元素 || 'anemo');
  const talentsRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (initialSection === 'talents') talentsRef.current?.scrollIntoView({ block: 'start' });
  }, [initialSection]);
  return <div className="space-y-6" aria-label="元素与天赋">
    <PathPanel {...elementState} traveler={traveler} onTravelerChange={onTravelerChange} browsedElement={browsedElement} onBrowseElement={setBrowsedElement} />
    <section ref={talentsRef} aria-label="天赋区域">
      <SkillPanel traveler={traveler} onTravelerChange={onTravelerChange} apiSettings={apiSettings} browsedElement={browsedElement} />
    </section>
  </div>;
}
