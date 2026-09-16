import { render } from 'hono/jsx/dom';
import { App } from './App';
import './styles.css';

const root = document.getElementById('root')!;
// index.html に置いた「読み込んでいます」は App が同じものを描くので外す
root.replaceChildren();
render(<App />, root);
