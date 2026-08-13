/** Jobs each post part is expected to do for the audience. */
export const PARTS = [
  { id: 'hook', label: 'Hook', job: 'Stop the scroll', value: 'Attention — give a reason to stay for one more second', lose: 'the scroll never stops, nobody reads the rest' },
  { id: 'body', label: 'Body', job: 'Deliver the promise', value: 'Trust — prove you understand their situation', lose: 'the hook’s promise is never paid off, readers bounce' },
  { id: 'media', label: 'Media', job: 'Make it felt', value: 'Attraction — image or motion that the text cannot carry alone', lose: 'the post reads flat next to media-first posts in feed' },
  { id: 'cta', label: 'Call', job: 'Name the next move', value: 'Action — one clear verb the platform already rewards', lose: 'interest has nowhere to go, it evaporates' },
  { id: 'tags', label: 'Tags', job: 'Find the room', value: 'Discovery — language the audience already uses to search', lose: 'only existing followers ever see it' }
];

const INTERACTIONS = {
  // X guidance below is read from published defaults in
  // xai-org/x-algorithm → home-mixer/params/param.rs (Apache-2.0), not from
  // folklore. Relative prices there: copy-link share 20, reply/quote/DM-share 5,
  // follow 4, repost 1, like 0.5, video-quality-view 0.05. Those are weights on
  // predicted actions inside For You ranking — they are NOT a score, and nothing
  // here is summed, ranked, or fed to the heuristic.
  x: {
    expect: [
      'a copy-link share into a group chat — priced far above a like',
      'replies and quote-posts, the conversation signals',
      'likes, which cost the reader least and are worth least of the actions a reader chooses to take'
    ],
    practices: [
      'Write a line worth pasting into a DM, not just tapping',
      'Ask one specific question a reply can actually answer',
      'Treat repliers as guests. People who follow each other are the conversation — manners, not a For You weight',
      'A clip under ten seconds falls below the video-duration floor'
    ]
  },
  instagram: {
    expect: ['saves for later', 'shares to stories', 'comment keywords tied to the CTA'],
    practices: ['Put the save-reason in the last line', 'Reply with a question, not a heart', 'Use carousel beats if the idea has steps']
  },
  tiktok: {
    expect: ['rewatches to catch the hook', 'stitches or duets that riff on it', 'comments that finish your sentence'],
    practices: ['Hook spoken in the first second, not just on-screen text', 'Leave a gap the commenter can finish', 'Pin a comment that restates the CTA']
  },
  youtube: {
    expect: ['watch time past the payoff', 'subscribe right after the payoff', 'comments with timestamps'],
    practices: ['Title must be a promise the first 20s keep', 'Ask for a timestamped story in the comments', 'End screen after the lesson, not during it']
  },
  linkedin: {
    expect: ['saves for a later scroll', 'thoughtful comments with a lived example', 'DMs from people hiring or buying'],
    practices: ['Short lines, one idea per line', 'Invite a lived example, not agreement', 'Do not hashtag-stuff']
  },
  facebook: {
    expect: ['shares into group chats', 'story-length comments', 'tags of someone who lived it'],
    practices: ['Write like a message to one person', 'Ask them to tag someone who lived it', 'Photo of a real scene beats stock']
  }
};

const MONETIZE = {
  x: ['paid newsletter mention', 'affiliate in reply, not the post', 'community waitlist'],
  instagram: ['bio link after a save CTA', 'collab post', 'broadcast-channel drop'],
  tiktok: ['shop tag only after value', 'series that leads to a paid live', 'spark-ad test of a winner'],
  youtube: ['mid-roll after the lesson', 'membership mention once', 'affiliate in description'],
  linkedin: ['lead magnet in first comment', 'offer a call for a narrow role', 'newsletter subscribe'],
  facebook: ['group join', 'event RSVP', 'local service booking']
};

const EFFECTS = {
  // Ordered by the published weights in x-algorithm home-mixer/params/param.rs,
  // heaviest first. Descriptions say what the action is worth relative to the
  // others — never a predicted number, never a rank.
  x: [
    { action: 'Copy-link share', effect: 'The most heavily weighted positive action X publishes — someone pasting it elsewhere' },
    { action: 'Reply or quote-post', effect: 'Conversation signals, weighted well below a copy-link share but far above a like' },
    { action: 'Repost', effect: 'Counts, but well below a reply — passing it on costs the reader almost nothing' },
    { action: 'Like', effect: 'The cheapest action to give and among the least weighted — a poor read on whether it landed' },
    { action: 'Video view', effect: 'In the model but weakly weighted, and clips under ten seconds fall below the duration floor' },
    { action: 'Mute, block or report', effect: 'Negative by a wide margin — far heavier than any positive action' }
  ],
  instagram: [
    { action: 'Save', effect: 'Strongest ranking signal on the platform — pushes it to Explore' },
    { action: 'Share to story', effect: 'Puts it in front of that person’s whole following for 24h' },
    { action: 'Comment', effect: 'Keeps the post active in the algorithm window longer' }
  ],
  tiktok: [
    { action: 'Rewatch', effect: 'Completion + replay rate is the top signal for the For You page' },
    { action: 'Stitch / duet', effect: 'Spawns a second video that re-surfaces the original' },
    { action: 'Comment', effect: 'Every reply reopens the video for other readers, extends its window' }
  ],
  youtube: [
    { action: 'Watch time', effect: 'The single biggest input to suggested/browse placement' },
    { action: 'Subscribe', effect: 'Converts a one-time viewer into a recurring impression' },
    { action: 'Timestamped comment', effect: 'Signals depth of engagement, surfaces highlight clips' }
  ],
  linkedin: [
    { action: 'Save', effect: 'Signals lasting value, ranks into more feeds without needing reshares' },
    { action: 'Comment', effect: 'Puts it into commenters’ networks as activity, compounds reach' },
    { action: 'DM', effect: 'Off-platform but the highest-intent outcome — a real conversation' }
  ],
  facebook: [
    { action: 'Share', effect: 'Moves it into a private feed with implied personal endorsement' },
    { action: 'Comment', effect: 'Keeps it alive in group and friend feeds longer' },
    { action: 'Tag', effect: 'Pulls in a second person’s attention and their network' }
  ]
};

export function effectsFor(platformId) {
  return EFFECTS[platformId] || EFFECTS.x;
}

export function structureFor(post) {
  return PARTS.map((part) => {
    const text = textForPart(post, part.id);
    return {
      ...part,
      filled: Boolean(text && String(text).trim()),
      preview: clip(text, 80)
    };
  });
}

export function interactionsFor(platformId) {
  return INTERACTIONS[platformId] || INTERACTIONS.x;
}

export function monetizeFor(platformId) {
  return MONETIZE[platformId] || MONETIZE.x;
}

function textForPart(post, id) {
  if (id === 'hook') return post.hook;
  if (id === 'body') return post.body;
  if (id === 'cta') return post.cta;
  if (id === 'tags') return (post.hashtags || []).join(' ');
  if (id === 'media') return (post.media && post.media.length) ? 'media' : '';
  return '';
}

function clip(s, n) {
  const t = String(s || '').trim();
  return t.length > n ? t.slice(0, n) + '…' : t;
}
