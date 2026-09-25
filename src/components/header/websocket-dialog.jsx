import style from './style.module.css';

import { useState, useRef, useEffect } from 'preact/hooks';

export function WebSocketDialog(props) {
  const { open, value, onConnect, onCancel } = props;

  const dialogRef = useRef();
  const [editValue, setEditValue] = useState(value);

  // <dialog> is opened and closed imperatively; showModal() also takes care
  // of focusing the autofocus field and closing on Escape.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (open && !dialog.open) {
      setEditValue(value);
      dialog.showModal();
    }
    else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open, value]);

  const handleSubmit = e => {
    e.preventDefault();
    onConnect(e, editValue);
  };

  const handleCancel = e => {
    e.preventDefault();
    onCancel();
  };

  return (
    <dialog ref={dialogRef} class={style.dialog} onCancel={handleCancel}
      aria-labelledby="ws-dialog-title">
      <form onSubmit={handleSubmit}>
        <h2 id="ws-dialog-title">Connect WebSocket</h2>
        <p>
          Please enter the WebSocket URL to connect to.{' '}
          <a href="https://github.com/masto/nabu.run#websockets"
            target="_blank" rel="noreferrer">(more info)</a>
        </p>
        <input
          type="url"
          aria-label="WebSocket URL"
          required
          autofocus
          value={editValue}
          onInput={e => setEditValue(e.currentTarget.value)}
        />
        <div class={style.dialogActions}>
          <button type="button" onClick={handleCancel}>Cancel</button>
          <button type="submit">Connect</button>
        </div>
      </form>
    </dialog>
  );
}
