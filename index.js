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
