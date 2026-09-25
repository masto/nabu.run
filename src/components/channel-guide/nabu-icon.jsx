import { useEffect, useRef } from 'preact/hooks';
import { DEFAULT_ICON, decodeIcon } from '../channel-list';
import style from './style.module.css';

// A channel's 16x16 icon, drawn at its native size and scaled up by CSS.
export function NabuIcon(props) {
  const { icon, size = 32 } = props;
  const canvasRef = useRef();

  useEffect(() => {
    const pixels = (icon && decodeIcon(icon)) ?? decodeIcon(DEFAULT_ICON);
    try {
      const ctx = canvasRef.current.getContext('2d');
      ctx.clearRect(0, 0, 16, 16);
      ctx.putImageData(new ImageData(pixels, 16, 16), 0, 0);
    }
    catch {
      // No canvas support (e.g. in tests); the icon just stays blank.
    }
  }, [icon]);

  return (
    <canvas ref={canvasRef} class={style.icon} width="16" height="16"
      style={{ width: `${size}px`, height: `${size}px` }} aria-hidden="true" />
  );
}
