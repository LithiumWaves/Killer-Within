void import('./thoughts/index.js')
    .then((module) => {
        module.setupThoughtsExtension?.();
    })
    .catch((error) => {
        console.error('[killer_within_thoughts] Failed to load thoughts module', error);
    });
