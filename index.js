void import('./thoughts/index.js')
    .then((module) => {
        module.setupThoughtsExtension?.();
    })
    .catch((error) => {
        console.error('[killer_within_thoughts] Failed to load thoughts module', error);
    });

void import('./deathnote/index.js')
    .then((module) => {
        module.setupDeathNoteExtension?.();
    })
    .catch((error) => {
        console.error('[killer_within_deathnote] Failed to load death note module', error);
    });

void import('./presence/index.js')
    .then((module) => {
        module.setupPresenceExtension?.();
    })
    .catch((error) => {
        console.error('[killer_within_presence] Failed to load presence module', error);
    });
