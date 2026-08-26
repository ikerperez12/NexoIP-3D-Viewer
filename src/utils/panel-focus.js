export function panelContainsFocusedElement(panel, activeElement) {
  return Boolean(
    panel
    && activeElement
    && typeof panel.contains === 'function'
    && panel.contains(activeElement),
  );
}
