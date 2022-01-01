# y-tiddlywiki

> [Tiddlywiki5](https://tiddlywiki.com/) binding for [Yjs](https://github.com/y-js/yjs) - [Demo](https://)

This binding maps a Y.Doc to a Tiddlywiki 5 instance. It optionally supports shared cursors via
the [quill-cursors](https://github.com/reedsy/quill-cursors) module. (??)

## Example

This example is transcluded into the served html file's <head> element by the tiddlywiki node.js server.

```js
import { TiddlywikiBinding } from 'y-tiddlywiki'
import Tiddlywiki from 'tiddlywiki'
//import QuillCursors from 'quill-cursors'

..

//Quill.register('modules/cursors', QuillCursors)

const type = ydoc.getText('quill')

var editor = new Quill('#editor-container', {
  modules: {
    cursors: true,
    toolbar: [
      [{ header: [1, 2, false] }],
      ['bold', 'italic', 'underline'],
      ['image', 'code-block']
    ]
  },
  placeholder: 'Start collaborating...',
  theme: 'snow' // or 'bubble'
})

// Optionally specify an Awareness instance, if supported by the Provider
const binding = new QuillBinding(type, editor, provider.awareness)

/*
// Define user name and user name
// Check the quill-cursors package on how to change the way cursors are rendered
provider.awareness.setLocalStateField('user', {
  name: 'Typing Jimmy',
  color: 'blue'
})
*/

```

## License

[The MIT License](./LICENSE) © Kevin Jahns, Joshua Fontany
