import { Dormouse } from '../desktop/Dormouse';

/** Initial sync is a connection state, not a project-picker loading state. */
export function ConnectionLoading({ down = false }: { down?: boolean }) {
  return <div className="companion-connecting" data-waiting={down}>
    <div className="companion-connecting-scene">
      <svg className="companion-connecting-cloud" viewBox="0 0 84 56" aria-hidden="true">
        <path d="M19 46C-2 46-3 20 18 18C22-3 54-2 59 18C82 14 91 46 67 46Z" />
        <path className="companion-cloud-smile" d="M35 31Q42 37 49 31" />
      </svg>
      <svg className="companion-connecting-string" viewBox="0 0 210 174" aria-hidden="true">
        <path d="M147 49Q153 84 105 123" />
      </svg>
      <div className="companion-connecting-mouse"><Dormouse size={112} priority={4} mood={down ? 1 : 2} label={down ? 'Waiting for your Mac' : 'Connecting to your Mac'} /></div>
    </div>
    <p className="mascot-hero-line" role="status">{down ? 'Waiting for your Mac' : 'Connecting to your Mac…'}</p>
    <p className="companion-home-note">{down ? 'We’ll keep trying in the background.' : 'Your projects and conversations will appear here.'}</p>
  </div>;
}
