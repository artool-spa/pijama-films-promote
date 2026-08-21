import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import AdEditForm, { type AdEditFormValues } from '../AdEditForm';

const baseValues: AdEditFormValues = {
  headlines: ['Watch the film'],
  bodies: ['A quiet story about a long summer.'],
  descriptions: ['Rent it tonight'],
};

function renderForm(props: Partial<React.ComponentProps<typeof AdEditForm>> = {}) {
  const onSubmit = vi.fn<(values: AdEditFormValues) => Promise<void>>().mockResolvedValue(undefined);
  render(<AdEditForm initial={baseValues} onSubmit={onSubmit} {...props} />);
  return { onSubmit };
}

/** The array editors have no labels, so locate them by their section heading. */
function inputsUnder(heading: string): HTMLInputElement[] {
  const section = screen.getByText(new RegExp(`^${heading} \\(`)).parentElement;
  if (!section) throw new Error(`No section for ${heading}`);
  return Array.from(section.querySelectorAll('input, textarea')) as HTMLInputElement[];
}

describe('AdEditForm', () => {
  it('does not render a call to action field', () => {
    renderForm();

    expect(screen.queryByLabelText(/call to action/i)).toBeNull();
    expect(screen.queryByText(/watch more/i)).toBeNull();
  });

  it('does not render a destination URL field', () => {
    renderForm();

    // The URL is derived from the film's rental URL and must not be editable.
    expect(screen.queryByLabelText(/destination url/i)).toBeNull();
  });

  it('reports live values to onChange as the producer types', async () => {
    const onChange = vi.fn();
    renderForm({ onChange });
    onChange.mockClear(); // Ignore the call on mount.

    fireEvent.change(inputsUnder('Headlines')[0], { target: { value: 'A new headline' } });

    await waitFor(() =>
      expect(onChange).toHaveBeenCalledWith(
        expect.objectContaining({ headlines: ['A new headline'] })
      )
    );
  });

  it('blocks submit when submitDisabled is set', async () => {
    const { onSubmit } = renderForm({ submitDisabled: true });

    const button = screen.getByRole('button', { name: 'Save changes' }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);

    fireEvent.click(button);
    await waitFor(() => expect(onSubmit).not.toHaveBeenCalled());
  });

  it('renders the custom submit label', () => {
    renderForm({ submitLabel: 'Save ad content' });

    expect(screen.getByRole('button', { name: 'Save ad content' })).toBeTruthy();
  });

  it('blocks submit with an inline error when the last headline is blanked out', async () => {
    const { onSubmit } = renderForm();

    fireEvent.change(inputsUnder('Headlines')[0], { target: { value: '   ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => {
      expect(screen.getByText('Add at least one headline.')).toBeTruthy();
    });
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('blocks submit when primary text is emptied', async () => {
    const { onSubmit } = renderForm();

    fireEvent.change(inputsUnder('Primary text')[0], { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => {
      expect(screen.getByText('Add at least one primary text.')).toBeTruthy();
    });
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('requires a description only when the ad is on Google', async () => {
    const { onSubmit } = renderForm({
      initial: { ...baseValues, descriptions: [] },
      requireDescription: true,
    });

    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => {
      expect(screen.getByText('Google Ads requires at least one description.')).toBeTruthy();
    });
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('submits trimmed values with blank entries filtered out', async () => {
    const { onSubmit } = renderForm();

    fireEvent.click(screen.getAllByRole('button', { name: 'Add' })[0]);
    const headlineInputs = inputsUnder('Headlines');
    fireEvent.change(headlineInputs[headlineInputs.length - 1], { target: { value: '  ' } });

    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit).toHaveBeenCalledWith({
      headlines: ['Watch the film'],
      bodies: ['A quiet story about a long summer.'],
      descriptions: ['Rent it tonight'],
    });
  });

  it('caps headline length at the Google limit when one is given', () => {
    renderForm({ headlineMaxLength: 40 });

    expect(inputsUnder('Headlines')[0].getAttribute('maxlength')).toBe('40');
    expect(screen.getByText(/Google Ads limits headlines to 40 characters/)).toBeTruthy();
  });

  it("uses Meta's headline limit by default", () => {
    renderForm();

    expect(inputsUnder('Headlines')[0].getAttribute('maxlength')).toBe('255');
  });
});
