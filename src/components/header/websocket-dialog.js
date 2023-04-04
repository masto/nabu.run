import style from './style.css';

import { useState, useRef, useEffect } from 'preact/hooks';

import Button from '@material-ui/core/Button';
import TextField from '@material-ui/core/TextField';
import Dialog from '@material-ui/core/Dialog';
import DialogActions from '@material-ui/core/DialogActions';
import DialogContent from '@material-ui/core/DialogContent';
import DialogContentText from '@material-ui/core/DialogContentText';
import DialogTitle from '@material-ui/core/DialogTitle';

export function WebSocketDialog(props) {
  const { open, value, onConnect, onCancel } = props;

  const [editValue, setEditValue] = useState(value);

  const handleCancel = () => {
    setEditValue(value);
    onCancel();
  };

  // Why?! https://github.com/mui/material-ui/issues/7247
  const MyTextField = () => {
    const inputRef = useRef();

    useEffect(() => {
      if (!inputRef.current) return;
      inputRef.current.focus();
    }, [inputRef]);

    return (
      <TextField
        inputRef={inputRef}
        margin="dense"
        id="url"
        type="url"
        fullWidth
        variant="filled"
        hiddenLabel
        size="small"
        value={editValue}
        onChange={e => setEditValue(e.target.value)}
      />
    );
  };

  return (
    <Dialog open={open} onClose={handleCancel}>
      <DialogTitle>Connect WebSocket</DialogTitle>
      <form onSubmit={() => onConnect(e, editValue)}>
        <DialogContent>
          <DialogContentText>
            Please enter the WebSocket URL to connect to.
          </DialogContentText>
          <MyTextField />
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCancel}>Cancel</Button>
          <Button type="submit" onClick={e => onConnect(e, editValue)}>Connect</Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}
