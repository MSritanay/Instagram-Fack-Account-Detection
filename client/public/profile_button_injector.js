// Profile button injector intentionally disabled.
// Keep this file wired in manifest for quick rollback without manifest edits.
(() => {
    console.log("[Instagram Authentication] Profile button injector disabled.");

    const idsToRemove = [
        "Instagram Authentication-analyze-btn",
        "Instagram Authentication-modal",
        "Instagram Authentication-notification",
    ];

    idsToRemove.forEach((id) => {
        const node = document.getElementById(id);
        if (node) node.remove();
    });

    // Defensive cleanup for older injected buttons/wrappers that may not retain the original id.
    const legacyButtons = Array.from(document.querySelectorAll("button")).filter(
        (btn) => btn.textContent && btn.textContent.trim().toLowerCase() === "analyze profile"
    );
    legacyButtons.forEach((btn) => {
        const wrapper = btn.parentElement;
        if (wrapper && wrapper.childElementCount === 1) {
            wrapper.remove();
        } else {
            btn.remove();
        }
    });

    // No observers, listeners, or DOM injections are registered.
})();

