(function (global, factory) {
	typeof exports === 'object' && typeof module !== 'undefined' ? factory(exports, require('lib0/dist/mutex.cjs'), require('yjs'), require('y-protocols/dist/awareness.cjs')) :
	typeof define === 'function' && define.amd ? define(['exports', 'lib0/dist/mutex.cjs', 'yjs', 'y-protocols/dist/awareness.cjs'], factory) :
	(global = typeof globalThis !== 'undefined' ? globalThis : global || self, factory(global["y-tiddlywiki"] = {}, global.mutex_js, global.Y));
})(this, (function (exports, mutex_js, Y) { 'use strict';

	function _interopNamespace(e) {
		if (e && e.__esModule) return e;
		var n = Object.create(null);
		if (e) {
			Object.keys(e).forEach(function (k) {
				if (k !== 'default') {
					var d = Object.getOwnPropertyDescriptor(e, k);
					Object.defineProperty(n, k, d.get ? d : {
						enumerable: true,
						get: function () { return e[k]; }
					});
				}
			});
		}
		n["default"] = e;
		return Object.freeze(n);
	}

	var Y__namespace = /*#__PURE__*/_interopNamespace(Y);

	const Delta = require('./delta-rollup.js'); // eslint-disable-line

	/**
	 * Removes the pending '\n's if it has no attributes.
	 */
	const normQuillDelta = delta => {
	  if (delta.length > 0) {
	    const d = delta[delta.length - 1];
	    const insert = d.insert;
	    if (d.attributes === undefined && insert !== undefined && insert.slice(-1) === '\n') {
	      delta = delta.slice();
	      let ins = insert.slice(0, -1);
	      while (ins.slice(-1) === '\n') {
	        ins = ins.slice(0, -1);
	      }
	      delta[delta.length - 1] = { insert: ins };
	      if (ins.length === 0) {
	        delta.pop();
	      }
	      return delta
	    }
	  }
	  return delta
	};

	 /**
	  * @param {any} twCursors
	  */
	const updateCursor = (twCursors, aw, clientId, doc, type) => {
	  try {
	  if (aw && aw.cursor && clientId !== doc.clientID) {
	    const user = aw.user || {};
	    const color = user.color || '#ffa500';
	    const name = user.name || `User: ${clientId}`;
	    twCursors.createCursor(clientId.toString(), name, color);
	    const anchor = Y__namespace.createAbsolutePositionFromRelativePosition(Y__namespace.createRelativePositionFromJSON(aw.cursor.anchor), doc);
	    const head = Y__namespace.createAbsolutePositionFromRelativePosition(Y__namespace.createRelativePositionFromJSON(aw.cursor.head), doc);
	    if (anchor && head && anchor.type === type) {
	    twCursors.moveCursor(clientId.toString(), { index: anchor.index, length: head.index - anchor.index });
	    }
	  } else {
	    twCursors.removeCursor(clientId.toString());
	  }
	  } catch (err) {
	  console.error(err);
	  }
	};
	class TiddlywikiBinding {
		/**
		* @param {any} options
		*/
		constructor (options) {
			// @ts-ignore
			if(!$tw.yjs.doc) throw new Error("TiddlywikiBinding Error: invalid $tw.yjs.doc.");

			if($tw.node){
				this.boot = options.boot || $tw.boot;
				// Setup a filesystem adaptor if required???
				if ($tw.wiki.tiddlerExists("$:/plugins/tiddlywiki/filesystem")) {
					const FileSystemAdaptor = require("$:/plugins/tiddlywiki/filesystem/filesystemadaptor.js").adaptorClass;
					$tw.yjs.fsadaptor = new FileSystemAdaptor({boot: $tw.boot, wiki: $tw.wiki});
				}
			} else {
				this.hasStatus = false;
				this.isLoggedIn = false;
				this.isReadOnly = false;
				this.isAnonymous = true;
			}
			
			this.wiki = options.wiki || $tw.wiki;
			this.logger = new $tw.utils.Logger("y-binding",{colour: $tw.node?"blue":"white"});
			// Find all fields that use $tw.utils.parseStringArray
			this.textFields = [];
			$tw.utils.each($tw.Tiddler.fieldModules,(module,name) => {
				if(module.parse == $tw.utils.parseStringArray) {
					this.textFields.push(name);
				}
			});


			const mux = mutex_js.createMutex();
			this.mux = mux;

			// Initialize the WikiDoc by applying the schema, and bind it to $tw
			this.wikiDoc = wikiDoc;

			const wikiTiddlers = wikiDoc.getArray("tiddlers");
			this.wikiTiddlers = wikiTiddlers;

			this.wikiTitles = wikiDoc.getArray("titles"); 
			this.wikiTombstones = wikiDoc.getArray("tombstones");

			const twCursors = null; //quill.getModule('cursors') || null
			this.twCursors = twCursors;
			this._setAwareness = (awareness) => {
				this.awareness = awareness;
				if (this.awareness && twCursors) {
					// init remote cursors
					this.awareness.getStates().forEach((aw, clientId) => {
						updateCursor(twCursors, aw, clientId, wikiDoc, wikiTiddlers);
					});
					this.awareness.on('change', this._awarenessChange);
				}
			};
			this._awarenessChange = ({ added, removed, updated }) => {
				/** @type {Awareness} */ (this.awareness).getStates();
				added.forEach(id => {
					//updateCursor(twCursors, awarenessStates.get(id), id, wikiDoc, wikiTiddlers)
				});
				updated.forEach(id => {
					//updateCursor(twCursors, awarenessStates.get(id), id, wikiDoc, wikiTiddlers)
				});
				removed.forEach(id => {
					//twCursors.removeCursor(id.toString())
				});
			};
			this._storeTiddler = (yMap) => {
				let fields = yMap.toJSON();
				if($tw.node) {
					$tw.syncer.wiki.addTiddler(new $tw.Tiddler(fields));
				} else {
					$tw.syncer.storeTiddler(fields);
				}
			};
			this._tiddlersObserver = (events,transaction) => {
				mux(() => {
					if(transaction.origin !== this) {
						let targets = new Set();
						events.forEach(event => {
							if(!event.target.parent) {
								// Top level event, one or more tiddlers added
								event.changes.added && event.changes.added.forEach(item => {
									targets.add(item.content.type);
								});
							} else {
								// YMap or YText event, a tiddler was updated
								targets.add(this.wikiTiddlers.get(event.path[0]));
							}
						});
						targets.forEach((target) => {
							this.logger.log(`Stored ${target.get('title')}`);
							this._storeTiddler(target);
						});
					}
				});
			};
			this._tombstonesObserver = (event,transaction) => {
				mux(() => {
					if(transaction.origin !== this) {
						event.changes.added && event.changes.added.forEach(item => {
							$tw.utils.each(item.content.arr,(title) => {
								// A tiddler was deleted
								this.logger.log(`Deleted ${title}`);
								$tw.syncer.wiki.deleteTiddler(title);
							});						
						});
					}
				});
			};
			this.wikiTiddlers.observeDeep(this._tiddlersObserver);
			this.wikiTombstones.observe(this._tombstonesObserver);
			this._updateSelection = () => {
				// always check selection
				if (this.awareness && twCursors) {
					const sel =	$tw.syncer.wiki.getSelection();
					const aw = /** @type {any} */ (this.awareness.getLocalState());
					if (sel === null) {
						if (this.awareness.getLocalState() !== null) {
							this.awareness.setLocalStateField('cursor', /** @type {any} */ (null));
						}
					} else {
						const anchor = Y__namespace.createRelativePositionFromTypeIndex(wikiTiddlers, sel.index);
						const head = Y__namespace.createRelativePositionFromTypeIndex(wikiTiddlers, sel.index + sel.length);
						if (!aw || !aw.cursor || !Y__namespace.compareRelativePositions(anchor, aw.cursor.anchor) || !Y__namespace.compareRelativePositions(head, aw.cursor.head)) {
							this.awareness.setLocalStateField('cursor', {
								anchor,
								head
							});
						}
					}
					// update all remote cursor locations
					this.awareness.getStates().forEach((aw, clientId) => {
						updateCursor(twCursors, aw, clientId, wikiDoc, wikiTiddlers);
					});
				}
			};
			this._save = (tiddler) => {
				// Only proccess a save if not read-only & hash of both sides of the binding are different
				if(!(tiddler instanceof $tw.Tiddler)) {
					return;
				}
				if ($tw.syncer.syncadaptor.isReadOnly) {
					$tw.syncer.enqueueLoadTiddler(tiddler.fields.title); 
				} else {
					let tiddlerIndex = this.wikiTitles.toArray().indexOf(tiddler.fields.title);
					let tiddlerMap = this.wikiTiddlers.get(tiddlerIndex) || new Y__namespace.Map();
					if(tiddlerIndex == -1){
						this.wikiTiddlers.push([tiddlerMap]);
						this.wikiTitles.push([tiddler.fields.title]);
					}
					let tsIndex = this.wikiTombstones.toArray().indexOf(tiddler.fields.title);
					if(tsIndex !== -1) {
						this.wikiTombstones.delete(tsIndex,1);
					}
					tiddlerMap.forEach((value,key) => {
						if(!tiddler.hasField(key)) {
							this.logger.log(`Update, remove '${key}' from '${tiddler.fields.title}'`);
							tiddlerMap.delete(key);
						}
					});
					$tw.utils.each(tiddler.getFieldStrings(),(field,name) => {
						if(	!tiddlerMap.has(name) ||
							$tw.utils.hashString(tiddlerMap.get(name).toString()) != $tw.utils.hashString(field)
						) {
							this.logger.log(`Update, set '${name}' on '${tiddler.fields.title}'`);
							if(name.startsWith("text") || this.textFields.indexOf(name) != -1) {
								let yText = tiddlerMap.get(name) || new Y__namespace.Text();
								if (!tiddlerMap.has(name)) {
									tiddlerMap.set(name,yText);
								}
								let oldDelta = new Delta().insert(yText.toString()),
								newDelta = new Delta().insert(field),
								diff = oldDelta.diff(newDelta);
								if(diff.ops.length > 0) {
									yText.applyDelta(diff.ops);
								}
							} else {
								tiddlerMap.set(name,field);
							}
						}
					});
				}
			};
			this._load = (title) => {
				let fields = null;
				let tiddlerIndex = this.wikiTitles.toArray().indexOf(title);
				if(this.wikiTombstones.toArray().indexOf(title) == -1 && tiddlerIndex !== -1) {
	        this.logger.log(`Loading ${title}`);
					fields = this.wikiTiddlers.get(tiddlerIndex).toJSON();
				}
				return fields
			};
			this._delete = (title) => {
				if ($tw.browser &&	$tw.syncer.syncadaptor.isReadOnly) {
					$tw.syncer.enqueueLoadTiddler(title); 
				} else {
					this.logger.log(`Delete tiddler ${title}`);
					let tiddlerIndex = this.wikiTitles.toArray().indexOf(title);
					if(tiddlerIndex !== -1 ) {
						this.wikiTitles.delete(tiddlerIndex,1);
						this.wikiTiddlers.delete(tiddlerIndex,1);
					}
					if(this.wikiTombstones.toArray().indexOf(title) == -1) {
						this.wikiTombstones.push([title]);
					}
				}
			};
			// Client awareness
			if(awareness) {
				this._setAwareness(awareness);
			}
		};

		//syncadaptor proeprties
		name = "y-tiddlywiki";
		supportsLazyLoading = false;

		setLoggerSaveBuffer (loggerForSaving) {
			this.logger.setSaveBuffer(loggerForSaving);
		}
		isReady () {
			return $tw.node? !!$tw.yjs.doc: $tw.yjs.session.synced;
		}
		getTiddlerInfo = function(tiddler) {
			return $tw.yjs.fsadaptor? $tw.yjs.fsadaptor.getTiddlerInfo(tiddler): null;
		}
		getStatus (callback) {
			this.logger.log("Getting status");
			let username = null;
			// Get status
			if(this.isReady()) {
				this.hasStatus = true;
				this.logger.log("Status:",JSON.stringify($tw.yjs.session.authStatus,null,$tw.config.preferences.jsonSpaces));
				// Check if we're logged in
				username = $tw.yjs.session.authStatus.username;
				this.isLoggedIn = !!$tw.yjs.session.authStatus.username;
				this.isReadOnly = !!$tw.yjs.session.authStatus["read_only"];
				this.isAnonymous = !!$tw.yjs.session.authStatus.anonymous;
			}
			// Invoke the callback if present
			if(callback) {
				// Invoke the callback if present
				return callback(null,this.isLoggedIn,username,this.isReadOnly,this.isAnonymous);
			}	
		}
		getUpdatedTiddlers = function(syncer,callback) {
			// Updates are real-time
			callback(null,{
				modifications: [],
				deletions: []
			});
		}

		/*
		Save a tiddler and invoke the callback with (err,adaptorInfo,revision)
		*/
		saveTiddler (tiddler,callback,options) {
			try{
				this.wikiDoc.transact(() => {
					this._save(tiddler);
				},this);
				this._updateSelection();
				if(!!$tw.yjs.fsadaptor) {
					return $tw.yjs.fsadaptor.saveTiddler(tiddler,callback,options)
				}
			} catch (error) {
				return callback(error)
			}
			return callback(null)
		}
		/*
		Load a tiddler and invoke the callback with (err,tiddlerFields)
		*/
		loadTiddler (title,callback) {
			let fields = null;
			try{
				fields = this._load(title);
				this._updateSelection();
			} catch (error) {
				return callback(error)
			}
			return callback(null,fields)
		}
		/*
		Delete a tiddler and invoke the callback with (err)
		*/
		deleteTiddler (title,callback,options) {
			try{
				this.wikiDoc.transact(() => {
					this._delete(title);
				},this);
				this._updateSelection();
			} catch (error) {
				return callback(error)
			}
			return callback(null)
		}
		
		setAwareness (awareness) {
			this.awareness && this.awareness.destroy();
			this._setAwareness(awareness);
			return this
		}
		initFromWikiDoc($tw) {
	    //
			let updates = {
				modifications: new Array(),
				deletions: new Array()
			};
			let titles = $tw.syncer.filterFn.call($tw.syncer.wiki),
				maps = this.wikiTitles.toArray(),
				diff = titles.filter(x => maps.indexOf(x) === -1);
			// Delete those that are in titles, but not in maps
			diff.forEach((title) => {
				updates.deletions.push(title);
			});
			// Compare and update the tiddlers from the maps
			maps.forEach((title) => {
				let tiddler = $tw.syncer.wiki.getTiddler(title),
					yTiddler = new $tw.Tiddler(this._load(title));
				if(!tiddler.isEqual(yTiddler)) {
					updates.modifications.push(title);
				}
			});
			return updates
		}
		updateWikiDoc($tw) {
			// Compare all tiddlers in the $tw.wiki to their YDoc maps on node server startup
			this.wikiDoc.transact(() => {
				let titles = $tw.syncer.filterFn.call($tw.syncer.wiki),
					maps = this.wikiTitles.toArray(),
					diff = maps.filter(x => titles.indexOf(x) === -1);
				// Delete those that are in maps, but not in titles
				this.logger.log(`Startup, deleting ${diff.length} tiddlers`);
				diff.forEach((title) => {
					this._delete(title);
				});
				// Update the tiddlers that changed during server restart
				this.logger.log(`Startup, testing ${titles.length} tiddlers`);
				titles.forEach((title) => {
					this._save($tw.syncer.wiki.getTiddler(title));
				});
			},this);
		}

		destroy () {
			this.wikiTiddlers.unobserve(this._tiddlersObserver);
			if(this.awareness) {
				this.awareness.off('change', this._awarenessChange);
			}
		}
	}

	if($tw.yjs.doc){
		if($tw.node) {
			TiddlywikiBinding.getStatus = null;
			TiddlywikiBinding.getUpdatedTiddlers = null;
		}
		exports.adaptorClass = TiddlywikiBinding;
	}

	exports.normQuillDelta = normQuillDelta;

	Object.defineProperty(exports, '__esModule', { value: true });

}));
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoieS10aWRkbHl3aWtpLmpzIiwic291cmNlcyI6WyIuLi9zcmMveS10aWRkbHl3aWtpLmpzIl0sInNvdXJjZXNDb250ZW50IjpbIlxuLypcXFxudGl0bGU6ICQ6L3BsdWdpbnMvQHR3NS95LXRpZGRseXdpa2kveS10aWRkbHl3aWtpLmpzXG50eXBlOiBhcHBsaWNhdGlvbi9qYXZhc2NyaXB0XG5tb2R1bGUtdHlwZTogc3luY2FkYXB0b3JcblxuQSB5anMgYmluZGluZyBjb25uZWN0aW5nIGEgWS5Eb2MgdG8gdGhlIGN1cnJlbnQgJHR3LlxuXG5cXCovXG5cbi8qanNsaW50IG5vZGU6IHRydWUsIGJyb3dzZXI6IHRydWUgKi9cbi8qZ2xvYmFsICR0dzogZmFsc2UgKi9cblwidXNlIHN0cmljdFwiO1xuXG4vKipcbiAqIEBtb2R1bGUgYmluZGluZ3MvdGlkZGx5d2lraVxuICovXG5cbi8vaW1wb3J0IHsgJHR3IH0gZnJvbSAndGlkZGx5d2lraSdcbmltcG9ydCB7IGNyZWF0ZU11dGV4IH0gZnJvbSAnbGliMC9tdXRleC5qcydcbmltcG9ydCAqIGFzIFkgZnJvbSAneWpzJyAvLyBlc2xpbnQtZGlzYWJsZS1saW5lXG5pbXBvcnQgeyBBd2FyZW5lc3MgfSBmcm9tICd5LXByb3RvY29scy9hd2FyZW5lc3MuanMnIC8vIGVzbGludC1kaXNhYmxlLWxpbmVcbmNvbnN0IERlbHRhID0gcmVxdWlyZSgnLi9kZWx0YS1yb2xsdXAuanMnKSAvLyBlc2xpbnQtZGlzYWJsZS1saW5lXG5cbi8qKlxuICogUmVtb3ZlcyB0aGUgcGVuZGluZyAnXFxuJ3MgaWYgaXQgaGFzIG5vIGF0dHJpYnV0ZXMuXG4gKi9cbmV4cG9ydCBjb25zdCBub3JtUXVpbGxEZWx0YSA9IGRlbHRhID0+IHtcbiAgaWYgKGRlbHRhLmxlbmd0aCA+IDApIHtcbiAgICBjb25zdCBkID0gZGVsdGFbZGVsdGEubGVuZ3RoIC0gMV1cbiAgICBjb25zdCBpbnNlcnQgPSBkLmluc2VydFxuICAgIGlmIChkLmF0dHJpYnV0ZXMgPT09IHVuZGVmaW5lZCAmJiBpbnNlcnQgIT09IHVuZGVmaW5lZCAmJiBpbnNlcnQuc2xpY2UoLTEpID09PSAnXFxuJykge1xuICAgICAgZGVsdGEgPSBkZWx0YS5zbGljZSgpXG4gICAgICBsZXQgaW5zID0gaW5zZXJ0LnNsaWNlKDAsIC0xKVxuICAgICAgd2hpbGUgKGlucy5zbGljZSgtMSkgPT09ICdcXG4nKSB7XG4gICAgICAgIGlucyA9IGlucy5zbGljZSgwLCAtMSlcbiAgICAgIH1cbiAgICAgIGRlbHRhW2RlbHRhLmxlbmd0aCAtIDFdID0geyBpbnNlcnQ6IGlucyB9XG4gICAgICBpZiAoaW5zLmxlbmd0aCA9PT0gMCkge1xuICAgICAgICBkZWx0YS5wb3AoKVxuICAgICAgfVxuICAgICAgcmV0dXJuIGRlbHRhXG4gICAgfVxuICB9XG4gIHJldHVybiBkZWx0YVxufVxuXG4gLyoqXG4gICogQHBhcmFtIHthbnl9IHR3Q3Vyc29yc1xuICAqL1xuY29uc3QgdXBkYXRlQ3Vyc29yID0gKHR3Q3Vyc29ycywgYXcsIGNsaWVudElkLCBkb2MsIHR5cGUpID0+IHtcbiAgdHJ5IHtcbiAgaWYgKGF3ICYmIGF3LmN1cnNvciAmJiBjbGllbnRJZCAhPT0gZG9jLmNsaWVudElEKSB7XG4gICAgY29uc3QgdXNlciA9IGF3LnVzZXIgfHwge31cbiAgICBjb25zdCBjb2xvciA9IHVzZXIuY29sb3IgfHwgJyNmZmE1MDAnXG4gICAgY29uc3QgbmFtZSA9IHVzZXIubmFtZSB8fCBgVXNlcjogJHtjbGllbnRJZH1gXG4gICAgdHdDdXJzb3JzLmNyZWF0ZUN1cnNvcihjbGllbnRJZC50b1N0cmluZygpLCBuYW1lLCBjb2xvcilcbiAgICBjb25zdCBhbmNob3IgPSBZLmNyZWF0ZUFic29sdXRlUG9zaXRpb25Gcm9tUmVsYXRpdmVQb3NpdGlvbihZLmNyZWF0ZVJlbGF0aXZlUG9zaXRpb25Gcm9tSlNPTihhdy5jdXJzb3IuYW5jaG9yKSwgZG9jKVxuICAgIGNvbnN0IGhlYWQgPSBZLmNyZWF0ZUFic29sdXRlUG9zaXRpb25Gcm9tUmVsYXRpdmVQb3NpdGlvbihZLmNyZWF0ZVJlbGF0aXZlUG9zaXRpb25Gcm9tSlNPTihhdy5jdXJzb3IuaGVhZCksIGRvYylcbiAgICBpZiAoYW5jaG9yICYmIGhlYWQgJiYgYW5jaG9yLnR5cGUgPT09IHR5cGUpIHtcbiAgICB0d0N1cnNvcnMubW92ZUN1cnNvcihjbGllbnRJZC50b1N0cmluZygpLCB7IGluZGV4OiBhbmNob3IuaW5kZXgsIGxlbmd0aDogaGVhZC5pbmRleCAtIGFuY2hvci5pbmRleCB9KVxuICAgIH1cbiAgfSBlbHNlIHtcbiAgICB0d0N1cnNvcnMucmVtb3ZlQ3Vyc29yKGNsaWVudElkLnRvU3RyaW5nKCkpXG4gIH1cbiAgfSBjYXRjaCAoZXJyKSB7XG4gIGNvbnNvbGUuZXJyb3IoZXJyKVxuICB9XG59XG5jbGFzcyBUaWRkbHl3aWtpQmluZGluZyB7XG5cdC8qKlxuXHQqIEBwYXJhbSB7YW55fSBvcHRpb25zXG5cdCovXG5cdGNvbnN0cnVjdG9yIChvcHRpb25zKSB7XG5cdFx0Ly8gQHRzLWlnbm9yZVxuXHRcdGlmKCEkdHcueWpzLmRvYykgdGhyb3cgbmV3IEVycm9yKFwiVGlkZGx5d2lraUJpbmRpbmcgRXJyb3I6IGludmFsaWQgJHR3Lnlqcy5kb2MuXCIpO1xuXG5cdFx0aWYoJHR3Lm5vZGUpe1xuXHRcdFx0dGhpcy5ib290ID0gb3B0aW9ucy5ib290IHx8ICR0dy5ib290O1xuXHRcdFx0Ly8gU2V0dXAgYSBmaWxlc3lzdGVtIGFkYXB0b3IgaWYgcmVxdWlyZWQ/Pz9cblx0XHRcdGlmICgkdHcud2lraS50aWRkbGVyRXhpc3RzKFwiJDovcGx1Z2lucy90aWRkbHl3aWtpL2ZpbGVzeXN0ZW1cIikpIHtcblx0XHRcdFx0Y29uc3QgRmlsZVN5c3RlbUFkYXB0b3IgPSByZXF1aXJlKFwiJDovcGx1Z2lucy90aWRkbHl3aWtpL2ZpbGVzeXN0ZW0vZmlsZXN5c3RlbWFkYXB0b3IuanNcIikuYWRhcHRvckNsYXNzXG5cdFx0XHRcdCR0dy55anMuZnNhZGFwdG9yID0gbmV3IEZpbGVTeXN0ZW1BZGFwdG9yKHtib290OiAkdHcuYm9vdCwgd2lraTogJHR3Lndpa2l9KVxuXHRcdFx0fVxuXHRcdH0gZWxzZSB7XG5cdFx0XHR0aGlzLmhhc1N0YXR1cyA9IGZhbHNlO1xuXHRcdFx0dGhpcy5pc0xvZ2dlZEluID0gZmFsc2U7XG5cdFx0XHR0aGlzLmlzUmVhZE9ubHkgPSBmYWxzZTtcblx0XHRcdHRoaXMuaXNBbm9ueW1vdXMgPSB0cnVlO1xuXHRcdH1cblx0XHRcblx0XHR0aGlzLndpa2kgPSBvcHRpb25zLndpa2kgfHwgJHR3Lndpa2k7XG5cdFx0dGhpcy5sb2dnZXIgPSBuZXcgJHR3LnV0aWxzLkxvZ2dlcihcInktYmluZGluZ1wiLHtjb2xvdXI6ICR0dy5ub2RlP1wiYmx1ZVwiOlwid2hpdGVcIn0pO1xuXHRcdC8vIEZpbmQgYWxsIGZpZWxkcyB0aGF0IHVzZSAkdHcudXRpbHMucGFyc2VTdHJpbmdBcnJheVxuXHRcdHRoaXMudGV4dEZpZWxkcyA9IFtdO1xuXHRcdCR0dy51dGlscy5lYWNoKCR0dy5UaWRkbGVyLmZpZWxkTW9kdWxlcywobW9kdWxlLG5hbWUpID0+IHtcblx0XHRcdGlmKG1vZHVsZS5wYXJzZSA9PSAkdHcudXRpbHMucGFyc2VTdHJpbmdBcnJheSkge1xuXHRcdFx0XHR0aGlzLnRleHRGaWVsZHMucHVzaChuYW1lKVxuXHRcdFx0fVxuXHRcdH0pO1xuXG5cblx0XHRjb25zdCBtdXggPSBjcmVhdGVNdXRleCgpXG5cdFx0dGhpcy5tdXggPSBtdXhcblxuXHRcdC8vIEluaXRpYWxpemUgdGhlIFdpa2lEb2MgYnkgYXBwbHlpbmcgdGhlIHNjaGVtYSwgYW5kIGJpbmQgaXQgdG8gJHR3XG5cdFx0dGhpcy53aWtpRG9jID0gd2lraURvY1xuXG5cdFx0Y29uc3Qgd2lraVRpZGRsZXJzID0gd2lraURvYy5nZXRBcnJheShcInRpZGRsZXJzXCIpXG5cdFx0dGhpcy53aWtpVGlkZGxlcnMgPSB3aWtpVGlkZGxlcnNcblxuXHRcdHRoaXMud2lraVRpdGxlcyA9IHdpa2lEb2MuZ2V0QXJyYXkoXCJ0aXRsZXNcIikgXG5cdFx0dGhpcy53aWtpVG9tYnN0b25lcyA9IHdpa2lEb2MuZ2V0QXJyYXkoXCJ0b21ic3RvbmVzXCIpXG5cblx0XHRjb25zdCB0d0N1cnNvcnMgPSBudWxsIC8vcXVpbGwuZ2V0TW9kdWxlKCdjdXJzb3JzJykgfHwgbnVsbFxuXHRcdHRoaXMudHdDdXJzb3JzID0gdHdDdXJzb3JzXG5cdFx0dGhpcy5fc2V0QXdhcmVuZXNzID0gKGF3YXJlbmVzcykgPT4ge1xuXHRcdFx0dGhpcy5hd2FyZW5lc3MgPSBhd2FyZW5lc3Ncblx0XHRcdGlmICh0aGlzLmF3YXJlbmVzcyAmJiB0d0N1cnNvcnMpIHtcblx0XHRcdFx0Ly8gaW5pdCByZW1vdGUgY3Vyc29yc1xuXHRcdFx0XHR0aGlzLmF3YXJlbmVzcy5nZXRTdGF0ZXMoKS5mb3JFYWNoKChhdywgY2xpZW50SWQpID0+IHtcblx0XHRcdFx0XHR1cGRhdGVDdXJzb3IodHdDdXJzb3JzLCBhdywgY2xpZW50SWQsIHdpa2lEb2MsIHdpa2lUaWRkbGVycylcblx0XHRcdFx0fSlcblx0XHRcdFx0dGhpcy5hd2FyZW5lc3Mub24oJ2NoYW5nZScsIHRoaXMuX2F3YXJlbmVzc0NoYW5nZSlcblx0XHRcdH1cblx0XHR9XG5cdFx0dGhpcy5fYXdhcmVuZXNzQ2hhbmdlID0gKHsgYWRkZWQsIHJlbW92ZWQsIHVwZGF0ZWQgfSkgPT4ge1xuXHRcdFx0Y29uc3QgYXdhcmVuZXNzU3RhdGVzID0gLyoqIEB0eXBlIHtBd2FyZW5lc3N9ICovICh0aGlzLmF3YXJlbmVzcykuZ2V0U3RhdGVzKClcblx0XHRcdGFkZGVkLmZvckVhY2goaWQgPT4ge1xuXHRcdFx0XHQvL3VwZGF0ZUN1cnNvcih0d0N1cnNvcnMsIGF3YXJlbmVzc1N0YXRlcy5nZXQoaWQpLCBpZCwgd2lraURvYywgd2lraVRpZGRsZXJzKVxuXHRcdFx0fSlcblx0XHRcdHVwZGF0ZWQuZm9yRWFjaChpZCA9PiB7XG5cdFx0XHRcdC8vdXBkYXRlQ3Vyc29yKHR3Q3Vyc29ycywgYXdhcmVuZXNzU3RhdGVzLmdldChpZCksIGlkLCB3aWtpRG9jLCB3aWtpVGlkZGxlcnMpXG5cdFx0XHR9KVxuXHRcdFx0cmVtb3ZlZC5mb3JFYWNoKGlkID0+IHtcblx0XHRcdFx0Ly90d0N1cnNvcnMucmVtb3ZlQ3Vyc29yKGlkLnRvU3RyaW5nKCkpXG5cdFx0XHR9KVxuXHRcdH1cblx0XHR0aGlzLl9zdG9yZVRpZGRsZXIgPSAoeU1hcCkgPT4ge1xuXHRcdFx0bGV0IGZpZWxkcyA9IHlNYXAudG9KU09OKCk7XG5cdFx0XHRpZigkdHcubm9kZSkge1xuXHRcdFx0XHQkdHcuc3luY2VyLndpa2kuYWRkVGlkZGxlcihuZXcgJHR3LlRpZGRsZXIoZmllbGRzKSk7XG5cdFx0XHR9IGVsc2Uge1xuXHRcdFx0XHQkdHcuc3luY2VyLnN0b3JlVGlkZGxlcihmaWVsZHMpO1xuXHRcdFx0fVxuXHRcdH1cblx0XHR0aGlzLl90aWRkbGVyc09ic2VydmVyID0gKGV2ZW50cyx0cmFuc2FjdGlvbikgPT4ge1xuXHRcdFx0bXV4KCgpID0+IHtcblx0XHRcdFx0aWYodHJhbnNhY3Rpb24ub3JpZ2luICE9PSB0aGlzKSB7XG5cdFx0XHRcdFx0bGV0IHRhcmdldHMgPSBuZXcgU2V0KCk7XG5cdFx0XHRcdFx0ZXZlbnRzLmZvckVhY2goZXZlbnQgPT4ge1xuXHRcdFx0XHRcdFx0aWYoIWV2ZW50LnRhcmdldC5wYXJlbnQpIHtcblx0XHRcdFx0XHRcdFx0Ly8gVG9wIGxldmVsIGV2ZW50LCBvbmUgb3IgbW9yZSB0aWRkbGVycyBhZGRlZFxuXHRcdFx0XHRcdFx0XHRldmVudC5jaGFuZ2VzLmFkZGVkICYmIGV2ZW50LmNoYW5nZXMuYWRkZWQuZm9yRWFjaChpdGVtID0+IHtcblx0XHRcdFx0XHRcdFx0XHR0YXJnZXRzLmFkZChpdGVtLmNvbnRlbnQudHlwZSk7XG5cdFx0XHRcdFx0XHRcdH0pO1xuXHRcdFx0XHRcdFx0fSBlbHNlIHtcblx0XHRcdFx0XHRcdFx0Ly8gWU1hcCBvciBZVGV4dCBldmVudCwgYSB0aWRkbGVyIHdhcyB1cGRhdGVkXG5cdFx0XHRcdFx0XHRcdHRhcmdldHMuYWRkKHRoaXMud2lraVRpZGRsZXJzLmdldChldmVudC5wYXRoWzBdKSk7XG5cdFx0XHRcdFx0XHR9XG5cdFx0XHRcdFx0fSk7XG5cdFx0XHRcdFx0dGFyZ2V0cy5mb3JFYWNoKCh0YXJnZXQpID0+IHtcblx0XHRcdFx0XHRcdHRoaXMubG9nZ2VyLmxvZyhgU3RvcmVkICR7dGFyZ2V0LmdldCgndGl0bGUnKX1gKTtcblx0XHRcdFx0XHRcdHRoaXMuX3N0b3JlVGlkZGxlcih0YXJnZXQpO1xuXHRcdFx0XHRcdH0pO1xuXHRcdFx0XHR9XG5cdFx0XHR9KVxuXHRcdH1cblx0XHR0aGlzLl90b21ic3RvbmVzT2JzZXJ2ZXIgPSAoZXZlbnQsdHJhbnNhY3Rpb24pID0+IHtcblx0XHRcdG11eCgoKSA9PiB7XG5cdFx0XHRcdGlmKHRyYW5zYWN0aW9uLm9yaWdpbiAhPT0gdGhpcykge1xuXHRcdFx0XHRcdGV2ZW50LmNoYW5nZXMuYWRkZWQgJiYgZXZlbnQuY2hhbmdlcy5hZGRlZC5mb3JFYWNoKGl0ZW0gPT4ge1xuXHRcdFx0XHRcdFx0JHR3LnV0aWxzLmVhY2goaXRlbS5jb250ZW50LmFyciwodGl0bGUpID0+IHtcblx0XHRcdFx0XHRcdFx0Ly8gQSB0aWRkbGVyIHdhcyBkZWxldGVkXG5cdFx0XHRcdFx0XHRcdHRoaXMubG9nZ2VyLmxvZyhgRGVsZXRlZCAke3RpdGxlfWApO1xuXHRcdFx0XHRcdFx0XHQkdHcuc3luY2VyLndpa2kuZGVsZXRlVGlkZGxlcih0aXRsZSk7XG5cdFx0XHRcdFx0XHR9KTtcdFx0XHRcdFx0XHRcblx0XHRcdFx0XHR9KTtcblx0XHRcdFx0fVxuXHRcdFx0fSlcblx0XHR9XG5cdFx0dGhpcy53aWtpVGlkZGxlcnMub2JzZXJ2ZURlZXAodGhpcy5fdGlkZGxlcnNPYnNlcnZlcilcblx0XHR0aGlzLndpa2lUb21ic3RvbmVzLm9ic2VydmUodGhpcy5fdG9tYnN0b25lc09ic2VydmVyKVxuXHRcdHRoaXMuX3VwZGF0ZVNlbGVjdGlvbiA9ICgpID0+IHtcblx0XHRcdC8vIGFsd2F5cyBjaGVjayBzZWxlY3Rpb25cblx0XHRcdGlmICh0aGlzLmF3YXJlbmVzcyAmJiB0d0N1cnNvcnMpIHtcblx0XHRcdFx0Y29uc3Qgc2VsID1cdCR0dy5zeW5jZXIud2lraS5nZXRTZWxlY3Rpb24oKVxuXHRcdFx0XHRjb25zdCBhdyA9IC8qKiBAdHlwZSB7YW55fSAqLyAodGhpcy5hd2FyZW5lc3MuZ2V0TG9jYWxTdGF0ZSgpKVxuXHRcdFx0XHRpZiAoc2VsID09PSBudWxsKSB7XG5cdFx0XHRcdFx0aWYgKHRoaXMuYXdhcmVuZXNzLmdldExvY2FsU3RhdGUoKSAhPT0gbnVsbCkge1xuXHRcdFx0XHRcdFx0dGhpcy5hd2FyZW5lc3Muc2V0TG9jYWxTdGF0ZUZpZWxkKCdjdXJzb3InLCAvKiogQHR5cGUge2FueX0gKi8gKG51bGwpKVxuXHRcdFx0XHRcdH1cblx0XHRcdFx0fSBlbHNlIHtcblx0XHRcdFx0XHRjb25zdCBhbmNob3IgPSBZLmNyZWF0ZVJlbGF0aXZlUG9zaXRpb25Gcm9tVHlwZUluZGV4KHdpa2lUaWRkbGVycywgc2VsLmluZGV4KVxuXHRcdFx0XHRcdGNvbnN0IGhlYWQgPSBZLmNyZWF0ZVJlbGF0aXZlUG9zaXRpb25Gcm9tVHlwZUluZGV4KHdpa2lUaWRkbGVycywgc2VsLmluZGV4ICsgc2VsLmxlbmd0aClcblx0XHRcdFx0XHRpZiAoIWF3IHx8ICFhdy5jdXJzb3IgfHwgIVkuY29tcGFyZVJlbGF0aXZlUG9zaXRpb25zKGFuY2hvciwgYXcuY3Vyc29yLmFuY2hvcikgfHwgIVkuY29tcGFyZVJlbGF0aXZlUG9zaXRpb25zKGhlYWQsIGF3LmN1cnNvci5oZWFkKSkge1xuXHRcdFx0XHRcdFx0dGhpcy5hd2FyZW5lc3Muc2V0TG9jYWxTdGF0ZUZpZWxkKCdjdXJzb3InLCB7XG5cdFx0XHRcdFx0XHRcdGFuY2hvcixcblx0XHRcdFx0XHRcdFx0aGVhZFxuXHRcdFx0XHRcdFx0fSlcblx0XHRcdFx0XHR9XG5cdFx0XHRcdH1cblx0XHRcdFx0Ly8gdXBkYXRlIGFsbCByZW1vdGUgY3Vyc29yIGxvY2F0aW9uc1xuXHRcdFx0XHR0aGlzLmF3YXJlbmVzcy5nZXRTdGF0ZXMoKS5mb3JFYWNoKChhdywgY2xpZW50SWQpID0+IHtcblx0XHRcdFx0XHR1cGRhdGVDdXJzb3IodHdDdXJzb3JzLCBhdywgY2xpZW50SWQsIHdpa2lEb2MsIHdpa2lUaWRkbGVycylcblx0XHRcdFx0fSlcblx0XHRcdH1cblx0XHR9XG5cdFx0dGhpcy5fc2F2ZSA9ICh0aWRkbGVyKSA9PiB7XG5cdFx0XHQvLyBPbmx5IHByb2NjZXNzIGEgc2F2ZSBpZiBub3QgcmVhZC1vbmx5ICYgaGFzaCBvZiBib3RoIHNpZGVzIG9mIHRoZSBiaW5kaW5nIGFyZSBkaWZmZXJlbnRcblx0XHRcdGlmKCEodGlkZGxlciBpbnN0YW5jZW9mICR0dy5UaWRkbGVyKSkge1xuXHRcdFx0XHRyZXR1cm47XG5cdFx0XHR9XG5cdFx0XHRpZiAoJHR3LnN5bmNlci5zeW5jYWRhcHRvci5pc1JlYWRPbmx5KSB7XG5cdFx0XHRcdCR0dy5zeW5jZXIuZW5xdWV1ZUxvYWRUaWRkbGVyKHRpZGRsZXIuZmllbGRzLnRpdGxlKTsgXG5cdFx0XHR9IGVsc2Uge1xuXHRcdFx0XHRsZXQgdGlkZGxlckluZGV4ID0gdGhpcy53aWtpVGl0bGVzLnRvQXJyYXkoKS5pbmRleE9mKHRpZGRsZXIuZmllbGRzLnRpdGxlKTtcblx0XHRcdFx0bGV0IHRpZGRsZXJNYXAgPSB0aGlzLndpa2lUaWRkbGVycy5nZXQodGlkZGxlckluZGV4KSB8fCBuZXcgWS5NYXAoKTtcblx0XHRcdFx0aWYodGlkZGxlckluZGV4ID09IC0xKXtcblx0XHRcdFx0XHR0aGlzLndpa2lUaWRkbGVycy5wdXNoKFt0aWRkbGVyTWFwXSk7XG5cdFx0XHRcdFx0dGhpcy53aWtpVGl0bGVzLnB1c2goW3RpZGRsZXIuZmllbGRzLnRpdGxlXSk7XG5cdFx0XHRcdH1cblx0XHRcdFx0bGV0IHRzSW5kZXggPSB0aGlzLndpa2lUb21ic3RvbmVzLnRvQXJyYXkoKS5pbmRleE9mKHRpZGRsZXIuZmllbGRzLnRpdGxlKTtcblx0XHRcdFx0aWYodHNJbmRleCAhPT0gLTEpIHtcblx0XHRcdFx0XHR0aGlzLndpa2lUb21ic3RvbmVzLmRlbGV0ZSh0c0luZGV4LDEpXG5cdFx0XHRcdH1cblx0XHRcdFx0dGlkZGxlck1hcC5mb3JFYWNoKCh2YWx1ZSxrZXkpID0+IHtcblx0XHRcdFx0XHRpZighdGlkZGxlci5oYXNGaWVsZChrZXkpKSB7XG5cdFx0XHRcdFx0XHR0aGlzLmxvZ2dlci5sb2coYFVwZGF0ZSwgcmVtb3ZlICcke2tleX0nIGZyb20gJyR7dGlkZGxlci5maWVsZHMudGl0bGV9J2ApO1xuXHRcdFx0XHRcdFx0dGlkZGxlck1hcC5kZWxldGUoa2V5KTtcblx0XHRcdFx0XHR9XG5cdFx0XHRcdH0pXG5cdFx0XHRcdCR0dy51dGlscy5lYWNoKHRpZGRsZXIuZ2V0RmllbGRTdHJpbmdzKCksKGZpZWxkLG5hbWUpID0+IHtcblx0XHRcdFx0XHRpZihcdCF0aWRkbGVyTWFwLmhhcyhuYW1lKSB8fFxuXHRcdFx0XHRcdFx0JHR3LnV0aWxzLmhhc2hTdHJpbmcodGlkZGxlck1hcC5nZXQobmFtZSkudG9TdHJpbmcoKSkgIT0gJHR3LnV0aWxzLmhhc2hTdHJpbmcoZmllbGQpXG5cdFx0XHRcdFx0KSB7XG5cdFx0XHRcdFx0XHR0aGlzLmxvZ2dlci5sb2coYFVwZGF0ZSwgc2V0ICcke25hbWV9JyBvbiAnJHt0aWRkbGVyLmZpZWxkcy50aXRsZX0nYCk7XG5cdFx0XHRcdFx0XHRpZihuYW1lLnN0YXJ0c1dpdGgoXCJ0ZXh0XCIpIHx8IHRoaXMudGV4dEZpZWxkcy5pbmRleE9mKG5hbWUpICE9IC0xKSB7XG5cdFx0XHRcdFx0XHRcdGxldCB5VGV4dCA9IHRpZGRsZXJNYXAuZ2V0KG5hbWUpIHx8IG5ldyBZLlRleHQoKTtcblx0XHRcdFx0XHRcdFx0aWYgKCF0aWRkbGVyTWFwLmhhcyhuYW1lKSkge1xuXHRcdFx0XHRcdFx0XHRcdHRpZGRsZXJNYXAuc2V0KG5hbWUseVRleHQpO1xuXHRcdFx0XHRcdFx0XHR9XG5cdFx0XHRcdFx0XHRcdGxldCBvbGREZWx0YSA9IG5ldyBEZWx0YSgpLmluc2VydCh5VGV4dC50b1N0cmluZygpKSxcblx0XHRcdFx0XHRcdFx0bmV3RGVsdGEgPSBuZXcgRGVsdGEoKS5pbnNlcnQoZmllbGQpLFxuXHRcdFx0XHRcdFx0XHRkaWZmID0gb2xkRGVsdGEuZGlmZihuZXdEZWx0YSk7XG5cdFx0XHRcdFx0XHRcdGlmKGRpZmYub3BzLmxlbmd0aCA+IDApIHtcblx0XHRcdFx0XHRcdFx0XHR5VGV4dC5hcHBseURlbHRhKGRpZmYub3BzKTtcblx0XHRcdFx0XHRcdFx0fVxuXHRcdFx0XHRcdFx0fSBlbHNlIHtcblx0XHRcdFx0XHRcdFx0dGlkZGxlck1hcC5zZXQobmFtZSxmaWVsZCk7XG5cdFx0XHRcdFx0XHR9XG5cdFx0XHRcdFx0fVxuXHRcdFx0XHR9KTtcblx0XHRcdH1cblx0XHR9XG5cdFx0dGhpcy5fbG9hZCA9ICh0aXRsZSkgPT4ge1xuXHRcdFx0bGV0IGZpZWxkcyA9IG51bGw7XG5cdFx0XHRsZXQgdGlkZGxlckluZGV4ID0gdGhpcy53aWtpVGl0bGVzLnRvQXJyYXkoKS5pbmRleE9mKHRpdGxlKVxuXHRcdFx0aWYodGhpcy53aWtpVG9tYnN0b25lcy50b0FycmF5KCkuaW5kZXhPZih0aXRsZSkgPT0gLTEgJiYgdGlkZGxlckluZGV4ICE9PSAtMSkge1xuICAgICAgICB0aGlzLmxvZ2dlci5sb2coYExvYWRpbmcgJHt0aXRsZX1gKVxuXHRcdFx0XHRmaWVsZHMgPSB0aGlzLndpa2lUaWRkbGVycy5nZXQodGlkZGxlckluZGV4KS50b0pTT04oKVxuXHRcdFx0fVxuXHRcdFx0cmV0dXJuIGZpZWxkc1xuXHRcdH1cblx0XHR0aGlzLl9kZWxldGUgPSAodGl0bGUpID0+IHtcblx0XHRcdGlmICgkdHcuYnJvd3NlciAmJlx0JHR3LnN5bmNlci5zeW5jYWRhcHRvci5pc1JlYWRPbmx5KSB7XG5cdFx0XHRcdCR0dy5zeW5jZXIuZW5xdWV1ZUxvYWRUaWRkbGVyKHRpdGxlKTsgXG5cdFx0XHR9IGVsc2Uge1xuXHRcdFx0XHR0aGlzLmxvZ2dlci5sb2coYERlbGV0ZSB0aWRkbGVyICR7dGl0bGV9YCk7XG5cdFx0XHRcdGxldCB0aWRkbGVySW5kZXggPSB0aGlzLndpa2lUaXRsZXMudG9BcnJheSgpLmluZGV4T2YodGl0bGUpXG5cdFx0XHRcdGlmKHRpZGRsZXJJbmRleCAhPT0gLTEgKSB7XG5cdFx0XHRcdFx0dGhpcy53aWtpVGl0bGVzLmRlbGV0ZSh0aWRkbGVySW5kZXgsMSlcblx0XHRcdFx0XHR0aGlzLndpa2lUaWRkbGVycy5kZWxldGUodGlkZGxlckluZGV4LDEpXG5cdFx0XHRcdH1cblx0XHRcdFx0aWYodGhpcy53aWtpVG9tYnN0b25lcy50b0FycmF5KCkuaW5kZXhPZih0aXRsZSkgPT0gLTEpIHtcblx0XHRcdFx0XHR0aGlzLndpa2lUb21ic3RvbmVzLnB1c2goW3RpdGxlXSlcblx0XHRcdFx0fVxuXHRcdFx0fVxuXHRcdH1cblx0XHQvLyBDbGllbnQgYXdhcmVuZXNzXG5cdFx0aWYoYXdhcmVuZXNzKSB7XG5cdFx0XHR0aGlzLl9zZXRBd2FyZW5lc3MoYXdhcmVuZXNzKVxuXHRcdH1cblx0fTtcblxuXHQvL3N5bmNhZGFwdG9yIHByb2VwcnRpZXNcblx0bmFtZSA9IFwieS10aWRkbHl3aWtpXCI7XG5cdHN1cHBvcnRzTGF6eUxvYWRpbmcgPSBmYWxzZTtcblxuXHRzZXRMb2dnZXJTYXZlQnVmZmVyIChsb2dnZXJGb3JTYXZpbmcpIHtcblx0XHR0aGlzLmxvZ2dlci5zZXRTYXZlQnVmZmVyKGxvZ2dlckZvclNhdmluZyk7XG5cdH1cblx0aXNSZWFkeSAoKSB7XG5cdFx0cmV0dXJuICR0dy5ub2RlPyAhISR0dy55anMuZG9jOiAkdHcueWpzLnNlc3Npb24uc3luY2VkO1xuXHR9XG5cdGdldFRpZGRsZXJJbmZvID0gZnVuY3Rpb24odGlkZGxlcikge1xuXHRcdHJldHVybiAkdHcueWpzLmZzYWRhcHRvcj8gJHR3Lnlqcy5mc2FkYXB0b3IuZ2V0VGlkZGxlckluZm8odGlkZGxlcik6IG51bGw7XG5cdH1cblx0Z2V0U3RhdHVzIChjYWxsYmFjaykge1xuXHRcdHRoaXMubG9nZ2VyLmxvZyhcIkdldHRpbmcgc3RhdHVzXCIpO1xuXHRcdGxldCB1c2VybmFtZSA9IG51bGw7XG5cdFx0Ly8gR2V0IHN0YXR1c1xuXHRcdGlmKHRoaXMuaXNSZWFkeSgpKSB7XG5cdFx0XHR0aGlzLmhhc1N0YXR1cyA9IHRydWU7XG5cdFx0XHR0aGlzLmxvZ2dlci5sb2coXCJTdGF0dXM6XCIsSlNPTi5zdHJpbmdpZnkoJHR3Lnlqcy5zZXNzaW9uLmF1dGhTdGF0dXMsbnVsbCwkdHcuY29uZmlnLnByZWZlcmVuY2VzLmpzb25TcGFjZXMpKTtcblx0XHRcdC8vIENoZWNrIGlmIHdlJ3JlIGxvZ2dlZCBpblxuXHRcdFx0dXNlcm5hbWUgPSAkdHcueWpzLnNlc3Npb24uYXV0aFN0YXR1cy51c2VybmFtZTtcblx0XHRcdHRoaXMuaXNMb2dnZWRJbiA9ICEhJHR3Lnlqcy5zZXNzaW9uLmF1dGhTdGF0dXMudXNlcm5hbWU7XG5cdFx0XHR0aGlzLmlzUmVhZE9ubHkgPSAhISR0dy55anMuc2Vzc2lvbi5hdXRoU3RhdHVzW1wicmVhZF9vbmx5XCJdO1xuXHRcdFx0dGhpcy5pc0Fub255bW91cyA9ICEhJHR3Lnlqcy5zZXNzaW9uLmF1dGhTdGF0dXMuYW5vbnltb3VzO1xuXHRcdH1cblx0XHQvLyBJbnZva2UgdGhlIGNhbGxiYWNrIGlmIHByZXNlbnRcblx0XHRpZihjYWxsYmFjaykge1xuXHRcdFx0Ly8gSW52b2tlIHRoZSBjYWxsYmFjayBpZiBwcmVzZW50XG5cdFx0XHRyZXR1cm4gY2FsbGJhY2sobnVsbCx0aGlzLmlzTG9nZ2VkSW4sdXNlcm5hbWUsdGhpcy5pc1JlYWRPbmx5LHRoaXMuaXNBbm9ueW1vdXMpO1xuXHRcdH1cdFxuXHR9XG5cdGdldFVwZGF0ZWRUaWRkbGVycyA9IGZ1bmN0aW9uKHN5bmNlcixjYWxsYmFjaykge1xuXHRcdC8vIFVwZGF0ZXMgYXJlIHJlYWwtdGltZVxuXHRcdGNhbGxiYWNrKG51bGwse1xuXHRcdFx0bW9kaWZpY2F0aW9uczogW10sXG5cdFx0XHRkZWxldGlvbnM6IFtdXG5cdFx0fSk7XG5cdH1cblxuXHQvKlxuXHRTYXZlIGEgdGlkZGxlciBhbmQgaW52b2tlIHRoZSBjYWxsYmFjayB3aXRoIChlcnIsYWRhcHRvckluZm8scmV2aXNpb24pXG5cdCovXG5cdHNhdmVUaWRkbGVyICh0aWRkbGVyLGNhbGxiYWNrLG9wdGlvbnMpIHtcblx0XHR0cnl7XG5cdFx0XHR0aGlzLndpa2lEb2MudHJhbnNhY3QoKCkgPT4ge1xuXHRcdFx0XHR0aGlzLl9zYXZlKHRpZGRsZXIpXG5cdFx0XHR9LHRoaXMpO1xuXHRcdFx0dGhpcy5fdXBkYXRlU2VsZWN0aW9uKClcblx0XHRcdGlmKCEhJHR3Lnlqcy5mc2FkYXB0b3IpIHtcblx0XHRcdFx0cmV0dXJuICR0dy55anMuZnNhZGFwdG9yLnNhdmVUaWRkbGVyKHRpZGRsZXIsY2FsbGJhY2ssb3B0aW9ucylcblx0XHRcdH1cblx0XHR9IGNhdGNoIChlcnJvcikge1xuXHRcdFx0cmV0dXJuIGNhbGxiYWNrKGVycm9yKVxuXHRcdH1cblx0XHRyZXR1cm4gY2FsbGJhY2sobnVsbClcblx0fVxuXHQvKlxuXHRMb2FkIGEgdGlkZGxlciBhbmQgaW52b2tlIHRoZSBjYWxsYmFjayB3aXRoIChlcnIsdGlkZGxlckZpZWxkcylcblx0Ki9cblx0bG9hZFRpZGRsZXIgKHRpdGxlLGNhbGxiYWNrKSB7XG5cdFx0bGV0IGZpZWxkcyA9IG51bGxcblx0XHR0cnl7XG5cdFx0XHRmaWVsZHMgPSB0aGlzLl9sb2FkKHRpdGxlKVxuXHRcdFx0dGhpcy5fdXBkYXRlU2VsZWN0aW9uKClcblx0XHR9IGNhdGNoIChlcnJvcikge1xuXHRcdFx0cmV0dXJuIGNhbGxiYWNrKGVycm9yKVxuXHRcdH1cblx0XHRyZXR1cm4gY2FsbGJhY2sobnVsbCxmaWVsZHMpXG5cdH1cblx0Lypcblx0RGVsZXRlIGEgdGlkZGxlciBhbmQgaW52b2tlIHRoZSBjYWxsYmFjayB3aXRoIChlcnIpXG5cdCovXG5cdGRlbGV0ZVRpZGRsZXIgKHRpdGxlLGNhbGxiYWNrLG9wdGlvbnMpIHtcblx0XHR0cnl7XG5cdFx0XHR0aGlzLndpa2lEb2MudHJhbnNhY3QoKCkgPT4ge1xuXHRcdFx0XHR0aGlzLl9kZWxldGUodGl0bGUpXG5cdFx0XHR9LHRoaXMpO1xuXHRcdFx0dGhpcy5fdXBkYXRlU2VsZWN0aW9uKClcblx0XHR9IGNhdGNoIChlcnJvcikge1xuXHRcdFx0cmV0dXJuIGNhbGxiYWNrKGVycm9yKVxuXHRcdH1cblx0XHRyZXR1cm4gY2FsbGJhY2sobnVsbClcblx0fVxuXHRcblx0c2V0QXdhcmVuZXNzIChhd2FyZW5lc3MpIHtcblx0XHR0aGlzLmF3YXJlbmVzcyAmJiB0aGlzLmF3YXJlbmVzcy5kZXN0cm95KClcblx0XHR0aGlzLl9zZXRBd2FyZW5lc3MoYXdhcmVuZXNzKVxuXHRcdHJldHVybiB0aGlzXG5cdH1cblx0aW5pdEZyb21XaWtpRG9jKCR0dykge1xuICAgIC8vXG5cdFx0bGV0IHVwZGF0ZXMgPSB7XG5cdFx0XHRtb2RpZmljYXRpb25zOiBuZXcgQXJyYXkoKSxcblx0XHRcdGRlbGV0aW9uczogbmV3IEFycmF5KClcblx0XHR9XG5cdFx0bGV0IHRpdGxlcyA9ICR0dy5zeW5jZXIuZmlsdGVyRm4uY2FsbCgkdHcuc3luY2VyLndpa2kpLFxuXHRcdFx0bWFwcyA9IHRoaXMud2lraVRpdGxlcy50b0FycmF5KCksXG5cdFx0XHRkaWZmID0gdGl0bGVzLmZpbHRlcih4ID0+IG1hcHMuaW5kZXhPZih4KSA9PT0gLTEpXG5cdFx0Ly8gRGVsZXRlIHRob3NlIHRoYXQgYXJlIGluIHRpdGxlcywgYnV0IG5vdCBpbiBtYXBzXG5cdFx0ZGlmZi5mb3JFYWNoKCh0aXRsZSkgPT4ge1xuXHRcdFx0dXBkYXRlcy5kZWxldGlvbnMucHVzaCh0aXRsZSlcblx0XHR9KVxuXHRcdC8vIENvbXBhcmUgYW5kIHVwZGF0ZSB0aGUgdGlkZGxlcnMgZnJvbSB0aGUgbWFwc1xuXHRcdG1hcHMuZm9yRWFjaCgodGl0bGUpID0+IHtcblx0XHRcdGxldCB0aWRkbGVyID0gJHR3LnN5bmNlci53aWtpLmdldFRpZGRsZXIodGl0bGUpLFxuXHRcdFx0XHR5VGlkZGxlciA9IG5ldyAkdHcuVGlkZGxlcih0aGlzLl9sb2FkKHRpdGxlKSlcblx0XHRcdGlmKCF0aWRkbGVyLmlzRXF1YWwoeVRpZGRsZXIpKSB7XG5cdFx0XHRcdHVwZGF0ZXMubW9kaWZpY2F0aW9ucy5wdXNoKHRpdGxlKTtcblx0XHRcdH1cblx0XHR9KVxuXHRcdHJldHVybiB1cGRhdGVzXG5cdH1cblx0dXBkYXRlV2lraURvYygkdHcpIHtcblx0XHQvLyBDb21wYXJlIGFsbCB0aWRkbGVycyBpbiB0aGUgJHR3Lndpa2kgdG8gdGhlaXIgWURvYyBtYXBzIG9uIG5vZGUgc2VydmVyIHN0YXJ0dXBcblx0XHR0aGlzLndpa2lEb2MudHJhbnNhY3QoKCkgPT4ge1xuXHRcdFx0bGV0IHRpdGxlcyA9ICR0dy5zeW5jZXIuZmlsdGVyRm4uY2FsbCgkdHcuc3luY2VyLndpa2kpLFxuXHRcdFx0XHRtYXBzID0gdGhpcy53aWtpVGl0bGVzLnRvQXJyYXkoKSxcblx0XHRcdFx0ZGlmZiA9IG1hcHMuZmlsdGVyKHggPT4gdGl0bGVzLmluZGV4T2YoeCkgPT09IC0xKVxuXHRcdFx0Ly8gRGVsZXRlIHRob3NlIHRoYXQgYXJlIGluIG1hcHMsIGJ1dCBub3QgaW4gdGl0bGVzXG5cdFx0XHR0aGlzLmxvZ2dlci5sb2coYFN0YXJ0dXAsIGRlbGV0aW5nICR7ZGlmZi5sZW5ndGh9IHRpZGRsZXJzYClcblx0XHRcdGRpZmYuZm9yRWFjaCgodGl0bGUpID0+IHtcblx0XHRcdFx0dGhpcy5fZGVsZXRlKHRpdGxlKVxuXHRcdFx0fSlcblx0XHRcdC8vIFVwZGF0ZSB0aGUgdGlkZGxlcnMgdGhhdCBjaGFuZ2VkIGR1cmluZyBzZXJ2ZXIgcmVzdGFydFxuXHRcdFx0dGhpcy5sb2dnZXIubG9nKGBTdGFydHVwLCB0ZXN0aW5nICR7dGl0bGVzLmxlbmd0aH0gdGlkZGxlcnNgKVxuXHRcdFx0dGl0bGVzLmZvckVhY2goKHRpdGxlKSA9PiB7XG5cdFx0XHRcdHRoaXMuX3NhdmUoJHR3LnN5bmNlci53aWtpLmdldFRpZGRsZXIodGl0bGUpKVxuXHRcdFx0fSlcblx0XHR9LHRoaXMpXG5cdH1cblxuXHRkZXN0cm95ICgpIHtcblx0XHR0aGlzLndpa2lUaWRkbGVycy51bm9ic2VydmUodGhpcy5fdGlkZGxlcnNPYnNlcnZlcilcblx0XHRpZih0aGlzLmF3YXJlbmVzcykge1xuXHRcdFx0dGhpcy5hd2FyZW5lc3Mub2ZmKCdjaGFuZ2UnLCB0aGlzLl9hd2FyZW5lc3NDaGFuZ2UpXG5cdFx0fVxuXHR9XG59XG5cbmlmKCR0dy55anMuZG9jKXtcblx0aWYoJHR3Lm5vZGUpIHtcblx0XHRUaWRkbHl3aWtpQmluZGluZy5nZXRTdGF0dXMgPSBudWxsXG5cdFx0VGlkZGx5d2lraUJpbmRpbmcuZ2V0VXBkYXRlZFRpZGRsZXJzID0gbnVsbFxuXHR9XG5cdGV4cG9ydHMuYWRhcHRvckNsYXNzID0gVGlkZGx5d2lraUJpbmRpbmdcbn0iXSwibmFtZXMiOlsiWSIsImNyZWF0ZU11dGV4Il0sIm1hcHBpbmdzIjoiOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7OztDQXNCQSxNQUFNLEtBQUssR0FBRyxPQUFPLENBQUMsbUJBQW1CLEVBQUM7QUFDMUM7Q0FDQTtDQUNBO0NBQ0E7QUFDWSxPQUFDLGNBQWMsR0FBRyxLQUFLLElBQUk7Q0FDdkMsRUFBRSxJQUFJLEtBQUssQ0FBQyxNQUFNLEdBQUcsQ0FBQyxFQUFFO0NBQ3hCLElBQUksTUFBTSxDQUFDLEdBQUcsS0FBSyxDQUFDLEtBQUssQ0FBQyxNQUFNLEdBQUcsQ0FBQyxFQUFDO0NBQ3JDLElBQUksTUFBTSxNQUFNLEdBQUcsQ0FBQyxDQUFDLE9BQU07Q0FDM0IsSUFBSSxJQUFJLENBQUMsQ0FBQyxVQUFVLEtBQUssU0FBUyxJQUFJLE1BQU0sS0FBSyxTQUFTLElBQUksTUFBTSxDQUFDLEtBQUssQ0FBQyxDQUFDLENBQUMsQ0FBQyxLQUFLLElB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
