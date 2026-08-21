import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import AdMediaPicker, { type PickerAsset } from '../AdMediaPicker';

function makeAsset(overrides: Partial<PickerAsset> = {}): PickerAsset {
  return {
    id: 'a1',
    name: 'Poster',
    thumbnailUrl: 'https://cdn.test/poster.jpg',
    status: 'READY',
    aspectRatio: '1.91:1',
    usedInAds: 0,
    disabledReason: null,
    warning: null,
    ...overrides,
  };
}

function renderPicker(props: Partial<React.ComponentProps<typeof AdMediaPicker>> = {}) {
  const onChange = vi.fn();
  render(
    <AdMediaPicker
      label="Images"
      assets={[makeAsset(), makeAsset({ id: 'a2', name: 'Still' })]}
      selectedIds={['a1']}
      onChange={onChange}
      max={10}
      emptyMessage="This film has no images yet."
      {...props}
    />
  );
  return { onChange };
}

function checkboxOf(id: string): HTMLInputElement {
  const card = document.querySelector(`[data-testid="asset-${id}"]`);
  if (!card) throw new Error(`No asset card for ${id}`);
  return card.querySelector('input[type="checkbox"]') as HTMLInputElement;
}

describe('AdMediaPicker', () => {
  it('appends a newly selected asset instead of reordering', () => {
    // The parent diffs by index: reordering would fake a change.
    const { onChange } = renderPicker({ selectedIds: ['a2'] });

    fireEvent.click(checkboxOf('a1'));

    expect(onChange).toHaveBeenCalledWith(['a2', 'a1']);
  });

  it('removes an asset on uncheck', () => {
    const { onChange } = renderPicker({ selectedIds: ['a1', 'a2'] });

    fireEvent.click(checkboxOf('a1'));

    expect(onChange).toHaveBeenCalledWith(['a2']);
  });

  it('shows how many assets are selected', () => {
    renderPicker({ selectedIds: ['a1'] });

    expect(screen.getByText('1 of 10 selected')).toBeTruthy();
  });

  it('stops selecting past the cap but still allows deselecting', () => {
    renderPicker({ selectedIds: ['a1'], max: 1 });

    expect(checkboxOf('a2').disabled).toBe(true);
    expect(checkboxOf('a1').disabled).toBe(false);
  });

  it('blocks selecting a disabled asset but not removing it', () => {
    const blocked = makeAsset({ id: 'a2', disabledReason: 'Still uploading to Meta.' });

    const { onChange } = renderPicker({
      assets: [makeAsset(), blocked],
      selectedIds: ['a1'],
    });
    expect(checkboxOf('a2').disabled).toBe(true);

    // Same asset, now attached: it must be removable.
    renderPicker({ assets: [blocked], selectedIds: ['a2'] });
    fireEvent.click(checkboxOf('a2'));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('disables everything when read only', () => {
    renderPicker({ readOnly: true });

    expect(checkboxOf('a1').disabled).toBe(true);
    expect(checkboxOf('a2').disabled).toBe(true);
  });

  it('shows the empty message when the film has no assets', () => {
    renderPicker({ assets: [], selectedIds: [] });

    expect(screen.getByText('This film has no images yet.')).toBeTruthy();
  });

  it('renders an inline error', () => {
    renderPicker({ error: 'Select at least one asset.' });

    expect(screen.getByText('Select at least one asset.')).toBeTruthy();
  });
});
