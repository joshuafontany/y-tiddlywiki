(function (global, factory) {
	typeof exports === 'object' && typeof module !== 'undefined' ? module.exports = factory() :
	typeof define === 'function' && define.amd ? define(factory) :
	(global = typeof globalThis !== 'undefined' ? globalThis : global || self, global["quill-delta"] = factory());
})(this, (function () { 'use strict';

	var commonjsGlobal = typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : typeof global !== 'undefined' ? global : typeof self !== 'undefined' ? self : {};

	function createCommonjsModule(fn) {
	  var module = { exports: {} };
		return fn(module, module.exports), module.exports;
	}

	/**
	 * This library modifies the diff-patch-match library by Neil Fraser
	 * by removing the patch and match functionality and certain advanced
	 * options in the diff function. The original license is as follows:
	 *
	 * ===
	 *
	 * Diff Match and Patch
	 *
	 * Copyright 2006 Google Inc.
	 * http://code.google.com/p/google-diff-match-patch/
	 *
	 * Licensed under the Apache License, Version 2.0 (the "License");
	 * you may not use this file except in compliance with the License.
	 * You may obtain a copy of the License at
	 *
	 *   http://www.apache.org/licenses/LICENSE-2.0
	 *
	 * Unless required by applicable law or agreed to in writing, software
	 * distributed under the License is distributed on an "AS IS" BASIS,
	 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
	 * See the License for the specific language governing permissions and
	 * limitations under the License.
	 */
	/**
	 * The data structure representing a diff is an array of tuples:
	 * [[DIFF_DELETE, 'Hello'], [DIFF_INSERT, 'Goodbye'], [DIFF_EQUAL, ' world.']]
	 * which means: delete 'Hello', add 'Goodbye' and keep ' world.'
	 */
	var DIFF_DELETE = -1;
	var DIFF_INSERT = 1;
	var DIFF_EQUAL = 0;


	/**
	 * Find the differences between two texts.  Simplifies the problem by stripping
	 * any common prefix or suffix off the texts before diffing.
	 * @param {string} text1 Old string to be diffed.
	 * @param {string} text2 New string to be diffed.
	 * @param {Int|Object} [cursor_pos] Edit position in text1 or object with more info
	 * @return {Array} Array of diff tuples.
	 */
	function diff_main(text1, text2, cursor_pos, _fix_unicode) {
	  // Check for equality
	  if (text1 === text2) {
	    if (text1) {
	      return [[DIFF_EQUAL, text1]];
	    }
	    return [];
	  }

	  if (cursor_pos != null) {
	    var editdiff = find_cursor_edit_diff(text1, text2, cursor_pos);
	    if (editdiff) {
	      return editdiff;
	    }
	  }

	  // Trim off common prefix (speedup).
	  var commonlength = diff_commonPrefix(text1, text2);
	  var commonprefix = text1.substring(0, commonlength);
	  text1 = text1.substring(commonlength);
	  text2 = text2.substring(commonlength);

	  // Trim off common suffix (speedup).
	  commonlength = diff_commonSuffix(text1, text2);
	  var commonsuffix = text1.substring(text1.length - commonlength);
	  text1 = text1.substring(0, text1.length - commonlength);
	  text2 = text2.substring(0, text2.length - commonlength);

	  // Compute the diff on the middle block.
	  var diffs = diff_compute_(text1, text2);

	  // Restore the prefix and suffix.
	  if (commonprefix) {
	    diffs.unshift([DIFF_EQUAL, commonprefix]);
	  }
	  if (commonsuffix) {
	    diffs.push([DIFF_EQUAL, commonsuffix]);
	  }
	  diff_cleanupMerge(diffs, _fix_unicode);
	  return diffs;
	}

	/**
	 * Find the differences between two texts.  Assumes that the texts do not
	 * have any common prefix or suffix.
	 * @param {string} text1 Old string to be diffed.
	 * @param {string} text2 New string to be diffed.
	 * @return {Array} Array of diff tuples.
	 */
	function diff_compute_(text1, text2) {
	  var diffs;

	  if (!text1) {
	    // Just add some text (speedup).
	    return [[DIFF_INSERT, text2]];
	  }

	  if (!text2) {
	    // Just delete some text (speedup).
	    return [[DIFF_DELETE, text1]];
	  }

	  var longtext = text1.length > text2.length ? text1 : text2;
	  var shorttext = text1.length > text2.length ? text2 : text1;
	  var i = longtext.indexOf(shorttext);
	  if (i !== -1) {
	    // Shorter text is inside the longer text (speedup).
	    diffs = [
	      [DIFF_INSERT, longtext.substring(0, i)],
	      [DIFF_EQUAL, shorttext],
	      [DIFF_INSERT, longtext.substring(i + shorttext.length)]
	    ];
	    // Swap insertions for deletions if diff is reversed.
	    if (text1.length > text2.length) {
	      diffs[0][0] = diffs[2][0] = DIFF_DELETE;
	    }
	    return diffs;
	  }

	  if (shorttext.length === 1) {
	    // Single character string.
	    // After the previous speedup, the character can't be an equality.
	    return [[DIFF_DELETE, text1], [DIFF_INSERT, text2]];
	  }

	  // Check to see if the problem can be split in two.
	  var hm = diff_halfMatch_(text1, text2);
	  if (hm) {
	    // A half-match was found, sort out the return data.
	    var text1_a = hm[0];
	    var text1_b = hm[1];
	    var text2_a = hm[2];
	    var text2_b = hm[3];
	    var mid_common = hm[4];
	    // Send both pairs off for separate processing.
	    var diffs_a = diff_main(text1_a, text2_a);
	    var diffs_b = diff_main(text1_b, text2_b);
	    // Merge the results.
	    return diffs_a.concat([[DIFF_EQUAL, mid_common]], diffs_b);
	  }

	  return diff_bisect_(text1, text2);
	}

	/**
	 * Find the 'middle snake' of a diff, split the problem in two
	 * and return the recursively constructed diff.
	 * See Myers 1986 paper: An O(ND) Difference Algorithm and Its Variations.
	 * @param {string} text1 Old string to be diffed.
	 * @param {string} text2 New string to be diffed.
	 * @return {Array} Array of diff tuples.
	 * @private
	 */
	function diff_bisect_(text1, text2) {
	  // Cache the text lengths to prevent multiple calls.
	  var text1_length = text1.length;
	  var text2_length = text2.length;
	  var max_d = Math.ceil((text1_length + text2_length) / 2);
	  var v_offset = max_d;
	  var v_length = 2 * max_d;
	  var v1 = new Array(v_length);
	  var v2 = new Array(v_length);
	  // Setting all elements to -1 is faster in Chrome & Firefox than mixing
	  // integers and undefined.
	  for (var x = 0; x < v_length; x++) {
	    v1[x] = -1;
	    v2[x] = -1;
	  }
	  v1[v_offset + 1] = 0;
	  v2[v_offset + 1] = 0;
	  var delta = text1_length - text2_length;
	  // If the total number of characters is odd, then the front path will collide
	  // with the reverse path.
	  var front = (delta % 2 !== 0);
	  // Offsets for start and end of k loop.
	  // Prevents mapping of space beyond the grid.
	  var k1start = 0;
	  var k1end = 0;
	  var k2start = 0;
	  var k2end = 0;
	  for (var d = 0; d < max_d; d++) {
	    // Walk the front path one step.
	    for (var k1 = -d + k1start; k1 <= d - k1end; k1 += 2) {
	      var k1_offset = v_offset + k1;
	      var x1;
	      if (k1 === -d || (k1 !== d && v1[k1_offset - 1] < v1[k1_offset + 1])) {
	        x1 = v1[k1_offset + 1];
	      } else {
	        x1 = v1[k1_offset - 1] + 1;
	      }
	      var y1 = x1 - k1;
	      while (
	        x1 < text1_length && y1 < text2_length &&
	        text1.charAt(x1) === text2.charAt(y1)
	      ) {
	        x1++;
	        y1++;
	      }
	      v1[k1_offset] = x1;
	      if (x1 > text1_length) {
	        // Ran off the right of the graph.
	        k1end += 2;
	      } else if (y1 > text2_length) {
	        // Ran off the bottom of the graph.
	        k1start += 2;
	      } else if (front) {
	        var k2_offset = v_offset + delta - k1;
	        if (k2_offset >= 0 && k2_offset < v_length && v2[k2_offset] !== -1) {
	          // Mirror x2 onto top-left coordinate system.
	          var x2 = text1_length - v2[k2_offset];
	          if (x1 >= x2) {
	            // Overlap detected.
	            return diff_bisectSplit_(text1, text2, x1, y1);
	          }
	        }
	      }
	    }

	    // Walk the reverse path one step.
	    for (var k2 = -d + k2start; k2 <= d - k2end; k2 += 2) {
	      var k2_offset = v_offset + k2;
	      var x2;
	      if (k2 === -d || (k2 !== d && v2[k2_offset - 1] < v2[k2_offset + 1])) {
	        x2 = v2[k2_offset + 1];
	      } else {
	        x2 = v2[k2_offset - 1] + 1;
	      }
	      var y2 = x2 - k2;
	      while (
	        x2 < text1_length && y2 < text2_length &&
	        text1.charAt(text1_length - x2 - 1) === text2.charAt(text2_length - y2 - 1)
	      ) {
	        x2++;
	        y2++;
	      }
	      v2[k2_offset] = x2;
	      if (x2 > text1_length) {
	        // Ran off the left of the graph.
	        k2end += 2;
	      } else if (y2 > text2_length) {
	        // Ran off the top of the graph.
	        k2start += 2;
	      } else if (!front) {
	        var k1_offset = v_offset + delta - k2;
	        if (k1_offset >= 0 && k1_offset < v_length && v1[k1_offset] !== -1) {
	          var x1 = v1[k1_offset];
	          var y1 = v_offset + x1 - k1_offset;
	          // Mirror x2 onto top-left coordinate system.
	          x2 = text1_length - x2;
	          if (x1 >= x2) {
	            // Overlap detected.
	            return diff_bisectSplit_(text1, text2, x1, y1);
	          }
	        }
	      }
	    }
	  }
	  // Diff took too long and hit the deadline or
	  // number of diffs equals number of characters, no commonality at all.
	  return [[DIFF_DELETE, text1], [DIFF_INSERT, text2]];
	}

	/**
	 * Given the location of the 'middle snake', split the diff in two parts
	 * and recurse.
	 * @param {string} text1 Old string to be diffed.
	 * @param {string} text2 New string to be diffed.
	 * @param {number} x Index of split point in text1.
	 * @param {number} y Index of split point in text2.
	 * @return {Array} Array of diff tuples.
	 */
	function diff_bisectSplit_(text1, text2, x, y) {
	  var text1a = text1.substring(0, x);
	  var text2a = text2.substring(0, y);
	  var text1b = text1.substring(x);
	  var text2b = text2.substring(y);

	  // Compute both diffs serially.
	  var diffs = diff_main(text1a, text2a);
	  var diffsb = diff_main(text1b, text2b);

	  return diffs.concat(diffsb);
	}

	/**
	 * Determine the common prefix of two strings.
	 * @param {string} text1 First string.
	 * @param {string} text2 Second string.
	 * @return {number} The number of characters common to the start of each
	 *     string.
	 */
	function diff_commonPrefix(text1, text2) {
	  // Quick check for common null cases.
	  if (!text1 || !text2 || text1.charAt(0) !== text2.charAt(0)) {
	    return 0;
	  }
	  // Binary search.
	  // Performance analysis: http://neil.fraser.name/news/2007/10/09/
	  var pointermin = 0;
	  var pointermax = Math.min(text1.length, text2.length);
	  var pointermid = pointermax;
	  var pointerstart = 0;
	  while (pointermin < pointermid) {
	    if (
	      text1.substring(pointerstart, pointermid) ==
	      text2.substring(pointerstart, pointermid)
	    ) {
	      pointermin = pointermid;
	      pointerstart = pointermin;
	    } else {
	      pointermax = pointermid;
	    }
	    pointermid = Math.floor((pointermax - pointermin) / 2 + pointermin);
	  }

	  if (is_surrogate_pair_start(text1.charCodeAt(pointermid - 1))) {
	    pointermid--;
	  }

	  return pointermid;
	}

	/**
	 * Determine the common suffix of two strings.
	 * @param {string} text1 First string.
	 * @param {string} text2 Second string.
	 * @return {number} The number of characters common to the end of each string.
	 */
	function diff_commonSuffix(text1, text2) {
	  // Quick check for common null cases.
	  if (!text1 || !text2 || text1.slice(-1) !== text2.slice(-1)) {
	    return 0;
	  }
	  // Binary search.
	  // Performance analysis: http://neil.fraser.name/news/2007/10/09/
	  var pointermin = 0;
	  var pointermax = Math.min(text1.length, text2.length);
	  var pointermid = pointermax;
	  var pointerend = 0;
	  while (pointermin < pointermid) {
	    if (
	      text1.substring(text1.length - pointermid, text1.length - pointerend) ==
	      text2.substring(text2.length - pointermid, text2.length - pointerend)
	    ) {
	      pointermin = pointermid;
	      pointerend = pointermin;
	    } else {
	      pointermax = pointermid;
	    }
	    pointermid = Math.floor((pointermax - pointermin) / 2 + pointermin);
	  }

	  if (is_surrogate_pair_end(text1.charCodeAt(text1.length - pointermid))) {
	    pointermid--;
	  }

	  return pointermid;
	}

	/**
	 * Do the two texts share a substring which is at least half the length of the
	 * longer text?
	 * This speedup can produce non-minimal diffs.
	 * @param {string} text1 First string.
	 * @param {string} text2 Second string.
	 * @return {Array.<string>} Five element Array, containing the prefix of
	 *     text1, the suffix of text1, the prefix of text2, the suffix of
	 *     text2 and the common middle.  Or null if there was no match.
	 */
	function diff_halfMatch_(text1, text2) {
	  var longtext = text1.length > text2.length ? text1 : text2;
	  var shorttext = text1.length > text2.length ? text2 : text1;
	  if (longtext.length < 4 || shorttext.length * 2 < longtext.length) {
	    return null;  // Pointless.
	  }

	  /**
	   * Does a substring of shorttext exist within longtext such that the substring
	   * is at least half the length of longtext?
	   * Closure, but does not reference any external variables.
	   * @param {string} longtext Longer string.
	   * @param {string} shorttext Shorter string.
	   * @param {number} i Start index of quarter length substring within longtext.
	   * @return {Array.<string>} Five element Array, containing the prefix of
	   *     longtext, the suffix of longtext, the prefix of shorttext, the suffix
	   *     of shorttext and the common middle.  Or null if there was no match.
	   * @private
	   */
	  function diff_halfMatchI_(longtext, shorttext, i) {
	    // Start with a 1/4 length substring at position i as a seed.
	    var seed = longtext.substring(i, i + Math.floor(longtext.length / 4));
	    var j = -1;
	    var best_common = '';
	    var best_longtext_a, best_longtext_b, best_shorttext_a, best_shorttext_b;
	    while ((j = shorttext.indexOf(seed, j + 1)) !== -1) {
	      var prefixLength = diff_commonPrefix(
	        longtext.substring(i), shorttext.substring(j));
	      var suffixLength = diff_commonSuffix(
	        longtext.substring(0, i), shorttext.substring(0, j));
	      if (best_common.length < suffixLength + prefixLength) {
	        best_common = shorttext.substring(
	          j - suffixLength, j) + shorttext.substring(j, j + prefixLength);
	        best_longtext_a = longtext.substring(0, i - suffixLength);
	        best_longtext_b = longtext.substring(i + prefixLength);
	        best_shorttext_a = shorttext.substring(0, j - suffixLength);
	        best_shorttext_b = shorttext.substring(j + prefixLength);
	      }
	    }
	    if (best_common.length * 2 >= longtext.length) {
	      return [
	        best_longtext_a, best_longtext_b,
	        best_shorttext_a, best_shorttext_b, best_common
	      ];
	    } else {
	      return null;
	    }
	  }

	  // First check if the second quarter is the seed for a half-match.
	  var hm1 = diff_halfMatchI_(longtext, shorttext, Math.ceil(longtext.length / 4));
	  // Check again based on the third quarter.
	  var hm2 = diff_halfMatchI_(longtext, shorttext, Math.ceil(longtext.length / 2));
	  var hm;
	  if (!hm1 && !hm2) {
	    return null;
	  } else if (!hm2) {
	    hm = hm1;
	  } else if (!hm1) {
	    hm = hm2;
	  } else {
	    // Both matched.  Select the longest.
	    hm = hm1[4].length > hm2[4].length ? hm1 : hm2;
	  }

	  // A half-match was found, sort out the return data.
	  var text1_a, text1_b, text2_a, text2_b;
	  if (text1.length > text2.length) {
	    text1_a = hm[0];
	    text1_b = hm[1];
	    text2_a = hm[2];
	    text2_b = hm[3];
	  } else {
	    text2_a = hm[0];
	    text2_b = hm[1];
	    text1_a = hm[2];
	    text1_b = hm[3];
	  }
	  var mid_common = hm[4];
	  return [text1_a, text1_b, text2_a, text2_b, mid_common];
	}

	/**
	 * Reorder and merge like edit sections.  Merge equalities.
	 * Any edit section can move as long as it doesn't cross an equality.
	 * @param {Array} diffs Array of diff tuples.
	 * @param {boolean} fix_unicode Whether to normalize to a unicode-correct diff
	 */
	function diff_cleanupMerge(diffs, fix_unicode) {
	  diffs.push([DIFF_EQUAL, '']);  // Add a dummy entry at the end.
	  var pointer = 0;
	  var count_delete = 0;
	  var count_insert = 0;
	  var text_delete = '';
	  var text_insert = '';
	  var commonlength;
	  while (pointer < diffs.length) {
	    if (pointer < diffs.length - 1 && !diffs[pointer][1]) {
	      diffs.splice(pointer, 1);
	      continue;
	    }
	    switch (diffs[pointer][0]) {
	      case DIFF_INSERT:

	        count_insert++;
	        text_insert += diffs[pointer][1];
	        pointer++;
	        break;
	      case DIFF_DELETE:
	        count_delete++;
	        text_delete += diffs[pointer][1];
	        pointer++;
	        break;
	      case DIFF_EQUAL:
	        var previous_equality = pointer - count_insert - count_delete - 1;
	        if (fix_unicode) {
	          // prevent splitting of unicode surrogate pairs.  when fix_unicode is true,
	          // we assume that the old and new text in the diff are complete and correct
	          // unicode-encoded JS strings, but the tuple boundaries may fall between
	          // surrogate pairs.  we fix this by shaving off stray surrogates from the end
	          // of the previous equality and the beginning of this equality.  this may create
	          // empty equalities or a common prefix or suffix.  for example, if AB and AC are
	          // emojis, `[[0, 'A'], [-1, 'BA'], [0, 'C']]` would turn into deleting 'ABAC' and
	          // inserting 'AC', and then the common suffix 'AC' will be eliminated.  in this
	          // particular case, both equalities go away, we absorb any previous inequalities,
	          // and we keep scanning for the next equality before rewriting the tuples.
	          if (previous_equality >= 0 && ends_with_pair_start(diffs[previous_equality][1])) {
	            var stray = diffs[previous_equality][1].slice(-1);
	            diffs[previous_equality][1] = diffs[previous_equality][1].slice(0, -1);
	            text_delete = stray + text_delete;
	            text_insert = stray + text_insert;
	            if (!diffs[previous_equality][1]) {
	              // emptied out previous equality, so delete it and include previous delete/insert
	              diffs.splice(previous_equality, 1);
	              pointer--;
	              var k = previous_equality - 1;
	              if (diffs[k] && diffs[k][0] === DIFF_INSERT) {
	                count_insert++;
	                text_insert = diffs[k][1] + text_insert;
	                k--;
	              }
	              if (diffs[k] && diffs[k][0] === DIFF_DELETE) {
	                count_delete++;
	                text_delete = diffs[k][1] + text_delete;
	                k--;
	              }
	              previous_equality = k;
	            }
	          }
	          if (starts_with_pair_end(diffs[pointer][1])) {
	            var stray = diffs[pointer][1].charAt(0);
	            diffs[pointer][1] = diffs[pointer][1].slice(1);
	            text_delete += stray;
	            text_insert += stray;
	          }
	        }
	        if (pointer < diffs.length - 1 && !diffs[pointer][1]) {
	          // for empty equality not at end, wait for next equality
	          diffs.splice(pointer, 1);
	          break;
	        }
	        if (text_delete.length > 0 || text_insert.length > 0) {
	          // note that diff_commonPrefix and diff_commonSuffix are unicode-aware
	          if (text_delete.length > 0 && text_insert.length > 0) {
	            // Factor out any common prefixes.
	            commonlength = diff_commonPrefix(text_insert, text_delete);
	            if (commonlength !== 0) {
	              if (previous_equality >= 0) {
	                diffs[previous_equality][1] += text_insert.substring(0, commonlength);
	              } else {
	                diffs.splice(0, 0, [DIFF_EQUAL, text_insert.substring(0, commonlength)]);
	                pointer++;
	              }
	              text_insert = text_insert.substring(commonlength);
	              text_delete = text_delete.substring(commonlength);
	            }
	            // Factor out any common suffixes.
	            commonlength = diff_commonSuffix(text_insert, text_delete);
	            if (commonlength !== 0) {
	              diffs[pointer][1] =
	                text_insert.substring(text_insert.length - commonlength) + diffs[pointer][1];
	              text_insert = text_insert.substring(0, text_insert.length - commonlength);
	              text_delete = text_delete.substring(0, text_delete.length - commonlength);
	            }
	          }
	          // Delete the offending records and add the merged ones.
	          var n = count_insert + count_delete;
	          if (text_delete.length === 0 && text_insert.length === 0) {
	            diffs.splice(pointer - n, n);
	            pointer = pointer - n;
	          } else if (text_delete.length === 0) {
	            diffs.splice(pointer - n, n, [DIFF_INSERT, text_insert]);
	            pointer = pointer - n + 1;
	          } else if (text_insert.length === 0) {
	            diffs.splice(pointer - n, n, [DIFF_DELETE, text_delete]);
	            pointer = pointer - n + 1;
	          } else {
	            diffs.splice(pointer - n, n, [DIFF_DELETE, text_delete], [DIFF_INSERT, text_insert]);
	            pointer = pointer - n + 2;
	          }
	        }
	        if (pointer !== 0 && diffs[pointer - 1][0] === DIFF_EQUAL) {
	          // Merge this equality with the previous one.
	          diffs[pointer - 1][1] += diffs[pointer][1];
	          diffs.splice(pointer, 1);
	        } else {
	          pointer++;
	        }
	        count_insert = 0;
	        count_delete = 0;
	        text_delete = '';
	        text_insert = '';
	        break;
	    }
	  }
	  if (diffs[diffs.length - 1][1] === '') {
	    diffs.pop();  // Remove the dummy entry at the end.
	  }

	  // Second pass: look for single edits surrounded on both sides by equalities
	  // which can be shifted sideways to eliminate an equality.
	  // e.g: A<ins>BA</ins>C -> <ins>AB</ins>AC
	  var changes = false;
	  pointer = 1;
	  // Intentionally ignore the first and last element (don't need checking).
	  while (pointer < diffs.length - 1) {
	    if (diffs[pointer - 1][0] === DIFF_EQUAL &&
	      diffs[pointer + 1][0] === DIFF_EQUAL) {
	      // This is a single edit surrounded by equalities.
	      if (diffs[pointer][1].substring(diffs[pointer][1].length -
	        diffs[pointer - 1][1].length) === diffs[pointer - 1][1]) {
	        // Shift the edit over the previous equality.
	        diffs[pointer][1] = diffs[pointer - 1][1] +
	          diffs[pointer][1].substring(0, diffs[pointer][1].length -
	            diffs[pointer - 1][1].length);
	        diffs[pointer + 1][1] = diffs[pointer - 1][1] + diffs[pointer + 1][1];
	        diffs.splice(pointer - 1, 1);
	        changes = true;
	      } else if (diffs[pointer][1].substring(0, diffs[pointer + 1][1].length) ==
	        diffs[pointer + 1][1]) {
	        // Shift the edit over the next equality.
	        diffs[pointer - 1][1] += diffs[pointer + 1][1];
	        diffs[pointer][1] =
	          diffs[pointer][1].substring(diffs[pointer + 1][1].length) +
	          diffs[pointer + 1][1];
	        diffs.splice(pointer + 1, 1);
	        changes = true;
	      }
	    }
	    pointer++;
	  }
	  // If shifts were made, the diff needs reordering and another shift sweep.
	  if (changes) {
	    diff_cleanupMerge(diffs, fix_unicode);
	  }
	}
	function is_surrogate_pair_start(charCode) {
	  return charCode >= 0xD800 && charCode <= 0xDBFF;
	}

	function is_surrogate_pair_end(charCode) {
	  return charCode >= 0xDC00 && charCode <= 0xDFFF;
	}

	function starts_with_pair_end(str) {
	  return is_surrogate_pair_end(str.charCodeAt(0));
	}

	function ends_with_pair_start(str) {
	  return is_surrogate_pair_start(str.charCodeAt(str.length - 1));
	}

	function remove_empty_tuples(tuples) {
	  var ret = [];
	  for (var i = 0; i < tuples.length; i++) {
	    if (tuples[i][1].length > 0) {
	      ret.push(tuples[i]);
	    }
	  }
	  return ret;
	}

	function make_edit_splice(before, oldMiddle, newMiddle, after) {
	  if (ends_with_pair_start(before) || starts_with_pair_end(after)) {
	    return null;
	  }
	  return remove_empty_tuples([
	    [DIFF_EQUAL, before],
	    [DIFF_DELETE, oldMiddle],
	    [DIFF_INSERT, newMiddle],
	    [DIFF_EQUAL, after]
	  ]);
	}

	function find_cursor_edit_diff(oldText, newText, cursor_pos) {
	  // note: this runs after equality check has ruled out exact equality
	  var oldRange = typeof cursor_pos === 'number' ?
	    { index: cursor_pos, length: 0 } : cursor_pos.oldRange;
	  var newRange = typeof cursor_pos === 'number' ?
	    null : cursor_pos.newRange;
	  // take into account the old and new selection to generate the best diff
	  // possible for a text edit.  for example, a text change from "xxx" to "xx"
	  // could be a delete or forwards-delete of any one of the x's, or the
	  // result of selecting two of the x's and typing "x".
	  var oldLength = oldText.length;
	  var newLength = newText.length;
	  if (oldRange.length === 0 && (newRange === null || newRange.length === 0)) {
	    // see if we have an insert or delete before or after cursor
	    var oldCursor = oldRange.index;
	    var oldBefore = oldText.slice(0, oldCursor);
	    var oldAfter = oldText.slice(oldCursor);
	    var maybeNewCursor = newRange ? newRange.index : null;
	    editBefore: {
	      // is this an insert or delete right before oldCursor?
	      var newCursor = oldCursor + newLength - oldLength;
	      if (maybeNewCursor !== null && maybeNewCursor !== newCursor) {
	        break editBefore;
	      }
	      if (newCursor < 0 || newCursor > newLength) {
	        break editBefore;
	      }
	      var newBefore = newText.slice(0, newCursor);
	      var newAfter = newText.slice(newCursor);
	      if (newAfter !== oldAfter) {
	        break editBefore;
	      }
	      var prefixLength = Math.min(oldCursor, newCursor);
	      var oldPrefix = oldBefore.slice(0, prefixLength);
	      var newPrefix = newBefore.slice(0, prefixLength);
	      if (oldPrefix !== newPrefix) {
	        break editBefore;
	      }
	      var oldMiddle = oldBefore.slice(prefixLength);
	      var newMiddle = newBefore.slice(prefixLength);
	      return make_edit_splice(oldPrefix, oldMiddle, newMiddle, oldAfter);
	    }
	    editAfter: {
	      // is this an insert or delete right after oldCursor?
	      if (maybeNewCursor !== null && maybeNewCursor !== oldCursor) {
	        break editAfter;
	      }
	      var cursor = oldCursor;
	      var newBefore = newText.slice(0, cursor);
	      var newAfter = newText.slice(cursor);
	      if (newBefore !== oldBefore) {
	        break editAfter;
	      }
	      var suffixLength = Math.min(oldLength - cursor, newLength - cursor);
	      var oldSuffix = oldAfter.slice(oldAfter.length - suffixLength);
	      var newSuffix = newAfter.slice(newAfter.length - suffixLength);
	      if (oldSuffix !== newSuffix) {
	        break editAfter;
	      }
	      var oldMiddle = oldAfter.slice(0, oldAfter.length - suffixLength);
	      var newMiddle = newAfter.slice(0, newAfter.length - suffixLength);
	      return make_edit_splice(oldBefore, oldMiddle, newMiddle, oldSuffix);
	    }
	  }
	  if (oldRange.length > 0 && newRange && newRange.length === 0) {
	    replaceRange: {
	      // see if diff could be a splice of the old selection range
	      var oldPrefix = oldText.slice(0, oldRange.index);
	      var oldSuffix = oldText.slice(oldRange.index + oldRange.length);
	      var prefixLength = oldPrefix.length;
	      var suffixLength = oldSuffix.length;
	      if (newLength < prefixLength + suffixLength) {
	        break replaceRange;
	      }
	      var newPrefix = newText.slice(0, prefixLength);
	      var newSuffix = newText.slice(newLength - suffixLength);
	      if (oldPrefix !== newPrefix || oldSuffix !== newSuffix) {
	        break replaceRange;
	      }
	      var oldMiddle = oldText.slice(prefixLength, oldLength - suffixLength);
	      var newMiddle = newText.slice(prefixLength, newLength - suffixLength);
	      return make_edit_splice(oldPrefix, oldMiddle, newMiddle, oldSuffix);
	    }
	  }

	  return null;
	}

	function diff(text1, text2, cursor_pos) {
	  // only pass fix_unicode=true at the top level, not when diff_main is
	  // recursively invoked
	  return diff_main(text1, text2, cursor_pos, true);
	}

	diff.INSERT = DIFF_INSERT;
	diff.DELETE = DIFF_DELETE;
	diff.EQUAL = DIFF_EQUAL;

	var diff_1 = diff;

	/**
	 * lodash (Custom Build) <https://lodash.com/>
	 * Build: `lodash modularize exports="npm" -o ./`
	 * Copyright jQuery Foundation and other contributors <https://jquery.org/>
	 * Released under MIT license <https://lodash.com/license>
	 * Based on Underscore.js 1.8.3 <http://underscorejs.org/LICENSE>
	 * Copyright Jeremy Ashkenas, DocumentCloud and Investigative Reporters & Editors
	 */

	var lodash_clonedeep = createCommonjsModule(function (module, exports) {
	/** Used as the size to enable large array optimizations. */
	var LARGE_ARRAY_SIZE = 200;

	/** Used to stand-in for `undefined` hash values. */
	var HASH_UNDEFINED = '__lodash_hash_undefined__';

	/** Used as references for various `Number` constants. */
	var MAX_SAFE_INTEGER = 9007199254740991;

	/** `Object#toString` result references. */
	var argsTag = '[object Arguments]',
	    arrayTag = '[object Array]',
	    boolTag = '[object Boolean]',
	    dateTag = '[object Date]',
	    errorTag = '[object Error]',
	    funcTag = '[object Function]',
	    genTag = '[object GeneratorFunction]',
	    mapTag = '[object Map]',
	    numberTag = '[object Number]',
	    objectTag = '[object Object]',
	    promiseTag = '[object Promise]',
	    regexpTag = '[object RegExp]',
	    setTag = '[object Set]',
	    stringTag = '[object String]',
	    symbolTag = '[object Symbol]',
	    weakMapTag = '[object WeakMap]';

	var arrayBufferTag = '[object ArrayBuffer]',
	    dataViewTag = '[object DataView]',
	    float32Tag = '[object Float32Array]',
	    float64Tag = '[object Float64Array]',
	    int8Tag = '[object Int8Array]',
	    int16Tag = '[object Int16Array]',
	    int32Tag = '[object Int32Array]',
	    uint8Tag = '[object Uint8Array]',
	    uint8ClampedTag = '[object Uint8ClampedArray]',
	    uint16Tag = '[object Uint16Array]',
	    uint32Tag = '[object Uint32Array]';

	/**
	 * Used to match `RegExp`
	 * [syntax characters](http://ecma-international.org/ecma-262/7.0/#sec-patterns).
	 */
	var reRegExpChar = /[\\^$.*+?()[\]{}|]/g;

	/** Used to match `RegExp` flags from their coerced string values. */
	var reFlags = /\w*$/;

	/** Used to detect host constructors (Safari). */
	var reIsHostCtor = /^\[object .+?Constructor\]$/;

	/** Used to detect unsigned integer values. */
	var reIsUint = /^(?:0|[1-9]\d*)$/;

	/** Used to identify `toStringTag` values supported by `_.clone`. */
	var cloneableTags = {};
	cloneableTags[argsTag] = cloneableTags[arrayTag] =
	cloneableTags[arrayBufferTag] = cloneableTags[dataViewTag] =
	cloneableTags[boolTag] = cloneableTags[dateTag] =
	cloneableTags[float32Tag] = cloneableTags[float64Tag] =
	cloneableTags[int8Tag] = cloneableTags[int16Tag] =
	cloneableTags[int32Tag] = cloneableTags[mapTag] =
	cloneableTags[numberTag] = cloneableTags[objectTag] =
	cloneableTags[regexpTag] = cloneableTags[setTag] =
	cloneableTags[stringTag] = cloneableTags[symbolTag] =
	cloneableTags[uint8Tag] = cloneableTags[uint8ClampedTag] =
	cloneableTags[uint16Tag] = cloneableTags[uint32Tag] = true;
	cloneableTags[errorTag] = cloneableTags[funcTag] =
	cloneableTags[weakMapTag] = false;

	/** Detect free variable `global` from Node.js. */
	var freeGlobal = typeof commonjsGlobal == 'object' && commonjsGlobal && commonjsGlobal.Object === Object && commonjsGlobal;

	/** Detect free variable `self`. */
	var freeSelf = typeof self == 'object' && self && self.Object === Object && self;

	/** Used as a reference to the global object. */
	var root = freeGlobal || freeSelf || Function('return this')();

	/** Detect free variable `exports`. */
	var freeExports = exports && !exports.nodeType && exports;

	/** Detect free variable `module`. */
	var freeModule = freeExports && 'object' == 'object' && module && !module.nodeType && module;

	/** Detect the popular CommonJS extension `module.exports`. */
	var moduleExports = freeModule && freeModule.exports === freeExports;

	/**
	 * Adds the key-value `pair` to `map`.
	 *
	 * @private
	 * @param {Object} map The map to modify.
	 * @param {Array} pair The key-value pair to add.
	 * @returns {Object} Returns `map`.
	 */
	function addMapEntry(map, pair) {
	  // Don't return `map.set` because it's not chainable in IE 11.
	  map.set(pair[0], pair[1]);
	  return map;
	}

	/**
	 * Adds `value` to `set`.
	 *
	 * @private
	 * @param {Object} set The set to modify.
	 * @param {*} value The value to add.
	 * @returns {Object} Returns `set`.
	 */
	function addSetEntry(set, value) {
	  // Don't return `set.add` because it's not chainable in IE 11.
	  set.add(value);
	  return set;
	}

	/**
	 * A specialized version of `_.forEach` for arrays without support for
	 * iteratee shorthands.
	 *
	 * @private
	 * @param {Array} [array] The array to iterate over.
	 * @param {Function} iteratee The function invoked per iteration.
	 * @returns {Array} Returns `array`.
	 */
	function arrayEach(array, iteratee) {
	  var index = -1,
	      length = array ? array.length : 0;

	  while (++index < length) {
	    if (iteratee(array[index], index, array) === false) {
	      break;
	    }
	  }
	  return array;
	}

	/**
	 * Appends the elements of `values` to `array`.
	 *
	 * @private
	 * @param {Array} array The array to modify.
	 * @param {Array} values The values to append.
	 * @returns {Array} Returns `array`.
	 */
	function arrayPush(array, values) {
	  var index = -1,
	      length = values.length,
	      offset = array.length;

	  while (++index < length) {
	    array[offset + index] = values[index];
	  }
	  return array;
	}

	/**
	 * A specialized version of `_.reduce` for arrays without support for
	 * iteratee shorthands.
	 *
	 * @private
	 * @param {Array} [array] The array to iterate over.
	 * @param {Function} iteratee The function invoked per iteration.
	 * @param {*} [accumulator] The initial value.
	 * @param {boolean} [initAccum] Specify using the first element of `array` as
	 *  the initial value.
	 * @returns {*} Returns the accumulated value.
	 */
	function arrayReduce(array, iteratee, accumulator, initAccum) {
	  var index = -1,
	      length = array ? array.length : 0;

	  if (initAccum && length) {
	    accumulator = array[++index];
	  }
	  while (++index < length) {
	    accumulator = iteratee(accumulator, array[index], index, array);
	  }
	  return accumulator;
	}

	/**
	 * The base implementation of `_.times` without support for iteratee shorthands
	 * or max array length checks.
	 *
	 * @private
	 * @param {number} n The number of times to invoke `iteratee`.
	 * @param {Function} iteratee The function invoked per iteration.
	 * @returns {Array} Returns the array of results.
	 */
	function baseTimes(n, iteratee) {
	  var index = -1,
	      result = Array(n);

	  while (++index < n) {
	    result[index] = iteratee(index);
	  }
	  return result;
	}

	/**
	 * Gets the value at `key` of `object`.
	 *
	 * @private
	 * @param {Object} [object] The object to query.
	 * @param {string} key The key of the property to get.
	 * @returns {*} Returns the property value.
	 */
	function getValue(object, key) {
	  return object == null ? undefined : object[key];
	}

	/**
	 * Checks if `value` is a host object in IE < 9.
	 *
	 * @private
	 * @param {*} value The value to check.
	 * @returns {boolean} Returns `true` if `value` is a host object, else `false`.
	 */
	function isHostObject(value) {
	  // Many host objects are `Object` objects that can coerce to strings
	  // despite having improperly defined `toString` methods.
	  var result = false;
	  if (value != null && typeof value.toString != 'function') {
	    try {
	      result = !!(value + '');
	    } catch (e) {}
	  }
	  return result;
	}

	/**
	 * Converts `map` to its key-value pairs.
	 *
	 * @private
	 * @param {Object} map The map to convert.
	 * @returns {Array} Returns the key-value pairs.
	 */
	function mapToArray(map) {
	  var index = -1,
	      result = Array(map.size);

	  map.forEach(function(value, key) {
	    result[++index] = [key, value];
	  });
	  return result;
	}

	/**
	 * Creates a unary function that invokes `func` with its argument transformed.
	 *
	 * @private
	 * @param {Function} func The function to wrap.
	 * @param {Function} transform The argument transform.
	 * @returns {Function} Returns the new function.
	 */
	function overArg(func, transform) {
	  return function(arg) {
	    return func(transform(arg));
	  };
	}

	/**
	 * Converts `set` to an array of its values.
	 *
	 * @private
	 * @param {Object} set The set to convert.
	 * @returns {Array} Returns the values.
	 */
	function setToArray(set) {
	  var index = -1,
	      result = Array(set.size);

	  set.forEach(function(value) {
	    result[++index] = value;
	  });
	  return result;
	}

	/** Used for built-in method references. */
	var arrayProto = Array.prototype,
	    funcProto = Function.prototype,
	    objectProto = Object.prototype;

	/** Used to detect overreaching core-js shims. */
	var coreJsData = root['__core-js_shared__'];

	/** Used to detect methods masquerading as native. */
	var maskSrcKey = (function() {
	  var uid = /[^.]+$/.exec(coreJsData && coreJsData.keys && coreJsData.keys.IE_PROTO || '');
	  return uid ? ('Symbol(src)_1.' + uid) : '';
	}());

	/** Used to resolve the decompiled source of functions. */
	var funcToString = funcProto.toString;

	/** Used to check objects for own properties. */
	var hasOwnProperty = objectProto.hasOwnProperty;

	/**
	 * Used to resolve the
	 * [`toStringTag`](http://ecma-international.org/ecma-262/7.0/#sec-object.prototype.tostring)
	 * of values.
	 */
	var objectToString = objectProto.toString;

	/** Used to detect if a method is native. */
	var reIsNative = RegExp('^' +
	  funcToString.call(hasOwnProperty).replace(reRegExpChar, '\\$&')
	  .replace(/hasOwnProperty|(function).*?(?=\\\()| for .+?(?=\\\])/g, '$1.*?') + '$'
	);

	/** Built-in value references. */
	var Buffer = moduleExports ? root.Buffer : undefined,
	    Symbol = root.Symbol,
	    Uint8Array = root.Uint8Array,
	    getPrototype = overArg(Object.getPrototypeOf, Object),
	    objectCreate = Object.create,
	    propertyIsEnumerable = objectProto.propertyIsEnumerable,
	    splice = arrayProto.splice;

	/* Built-in method references for those with the same name as other `lodash` methods. */
	var nativeGetSymbols = Object.getOwnPropertySymbols,
	    nativeIsBuffer = Buffer ? Buffer.isBuffer : undefined,
	    nativeKeys = overArg(Object.keys, Object);

	/* Built-in method references that are verified to be native. */
	var DataView = getNative(root, 'DataView'),
	    Map = getNative(root, 'Map'),
	    Promise = getNative(root, 'Promise'),
	    Set = getNative(root, 'Set'),
	    WeakMap = getNative(root, 'WeakMap'),
	    nativeCreate = getNative(Object, 'create');

	/** Used to detect maps, sets, and weakmaps. */
	var dataViewCtorString = toSource(DataView),
	    mapCtorString = toSource(Map),
	    promiseCtorString = toSource(Promise),
	    setCtorString = toSource(Set),
	    weakMapCtorString = toSource(WeakMap);

	/** Used to convert symbols to primitives and strings. */
	var symbolProto = Symbol ? Symbol.prototype : undefined,
	    symbolValueOf = symbolProto ? symbolProto.valueOf : undefined;

	/**
	 * Creates a hash object.
	 *
	 * @private
	 * @constructor
	 * @param {Array} [entries] The key-value pairs to cache.
	 */
	function Hash(entries) {
	  var index = -1,
	      length = entries ? entries.length : 0;

	  this.clear();
	  while (++index < length) {
	    var entry = entries[index];
	    this.set(entry[0], entry[1]);
	  }
	}

	/**
	 * Removes all key-value entries from the hash.
	 *
	 * @private
	 * @name clear
	 * @memberOf Hash
	 */
	function hashClear() {
	  this.__data__ = nativeCreate ? nativeCreate(null) : {};
	}

	/**
	 * Removes `key` and its value from the hash.
	 *
	 * @private
	 * @name delete
	 * @memberOf Hash
	 * @param {Object} hash The hash to modify.
	 * @param {string} key The key of the value to remove.
	 * @returns {boolean} Returns `true` if the entry was removed, else `false`.
	 */
	function hashDelete(key) {
	  return this.has(key) && delete this.__data__[key];
	}

	/**
	 * Gets the hash value for `key`.
	 *
	 * @private
	 * @name get
	 * @memberOf Hash
	 * @param {string} key The key of the value to get.
	 * @returns {*} Returns the entry value.
	 */
	function hashGet(key) {
	  var data = this.__data__;
	  if (nativeCreate) {
	    var result = data[key];
	    return result === HASH_UNDEFINED ? undefined : result;
	  }
	  return hasOwnProperty.call(data, key) ? data[key] : undefined;
	}

	/**
	 * Checks if a hash value for `key` exists.
	 *
	 * @private
	 * @name has
	 * @memberOf Hash
	 * @param {string} key The key of the entry to check.
	 * @returns {boolean} Returns `true` if an entry for `key` exists, else `false`.
	 */
	function hashHas(key) {
	  var data = this.__data__;
	  return nativeCreate ? data[key] !== undefined : hasOwnProperty.call(data, key);
	}

	/**
	 * Sets the hash `key` to `value`.
	 *
	 * @private
	 * @name set
	 * @memberOf Hash
	 * @param {string} key The key of the value to set.
	 * @param {*} value The value to set.
	 * @returns {Object} Returns the hash instance.
	 */
	function hashSet(key, value) {
	  var data = this.__data__;
	  data[key] = (nativeCreate && value === undefined) ? HASH_UNDEFINED : value;
	  return this;
	}

	// Add methods to `Hash`.
	Hash.prototype.clear = hashClear;
	Hash.prototype['delete'] = hashDelete;
	Hash.prototype.get = hashGet;
	Hash.prototype.has = hashHas;
	Hash.prototype.set = hashSet;

	/**
	 * Creates an list cache object.
	 *
	 * @private
	 * @constructor
	 * @param {Array} [entries] The key-value pairs to cache.
	 */
	function ListCache(entries) {
	  var index = -1,
	      length = entries ? entries.length : 0;

	  this.clear();
	  while (++index < length) {
	    var entry = entries[index];
	    this.set(entry[0], entry[1]);
	  }
	}

	/**
	 * Removes all key-value entries from the list cache.
	 *
	 * @private
	 * @name clear
	 * @memberOf ListCache
	 */
	function listCacheClear() {
	  this.__data__ = [];
	}

	/**
	 * Removes `key` and its value from the list cache.
	 *
	 * @private
	 * @name delete
	 * @memberOf ListCache
	 * @param {string} key The key of the value to remove.
	 * @returns {boolean} Returns `true` if the entry was removed, else `false`.
	 */
	function listCacheDelete(key) {
	  var data = this.__data__,
	      index = assocIndexOf(data, key);

	  if (index < 0) {
	    return false;
	  }
	  var lastIndex = data.length - 1;
	  if (index == lastIndex) {
	    data.pop();
	  } else {
	    splice.call(data, index, 1);
	  }
	  return true;
	}

	/**
	 * Gets the list cache value for `key`.
	 *
	 * @private
	 * @name get
	 * @memberOf ListCache
	 * @param {string} key The key of the value to get.
	 * @returns {*} Returns the entry value.
	 */
	function listCacheGet(key) {
	  var data = this.__data__,
	      index = assocIndexOf(data, key);

	  return index < 0 ? undefined : data[index][1];
	}

	/**
	 * Checks if a list cache value for `key` exists.
	 *
	 * @private
	 * @name has
	 * @memberOf ListCache
	 * @param {string} key The key of the entry to check.
	 * @returns {boolean} Returns `true` if an entry for `key` exists, else `false`.
	 */
	function listCacheHas(key) {
	  return assocIndexOf(this.__data__, key) > -1;
	}

	/**
	 * Sets the list cache `key` to `value`.
	 *
	 * @private
	 * @name set
	 * @memberOf ListCache
	 * @param {string} key The key of the value to set.
	 * @param {*} value The value to set.
	 * @returns {Object} Returns the list cache instance.
	 */
	function listCacheSet(key, value) {
	  var data = this.__data__,
	      index = assocIndexOf(data, key);

	  if (index < 0) {
	    data.push([key, value]);
	  } else {
	    data[index][1] = value;
	  }
	  return this;
	}

	// Add methods to `ListCache`.
	ListCache.prototype.clear = listCacheClear;
	ListCache.prototype['delete'] = listCacheDelete;
	ListCache.prototype.get = listCacheGet;
	ListCache.prototype.has = listCacheHas;
	ListCache.prototype.set = listCacheSet;

	/**
	 * Creates a map cache object to store key-value pairs.
	 *
	 * @private
	 * @constructor
	 * @param {Array} [entries] The key-value pairs to cache.
	 */
	function MapCache(entries) {
	  var index = -1,
	      length = entries ? entries.length : 0;

	  this.clear();
	  while (++index < length) {
	    var entry = entries[index];
	    this.set(entry[0], entry[1]);
	  }
	}

	/**
	 * Removes all key-value entries from the map.
	 *
	 * @private
	 * @name clear
	 * @memberOf MapCache
	 */
	function mapCacheClear() {
	  this.__data__ = {
	    'hash': new Hash,
	    'map': new (Map || ListCache),
	    'string': new Hash
	  };
	}

	/**
	 * Removes `key` and its value from the map.
	 *
	 * @private
	 * @name delete
	 * @memberOf MapCache
	 * @param {string} key The key of the value to remove.
	 * @returns {boolean} Returns `true` if the entry was removed, else `false`.
	 */
	function mapCacheDelete(key) {
	  return getMapData(this, key)['delete'](key);
	}

	/**
	 * Gets the map value for `key`.
	 *
	 * @private
	 * @name get
	 * @memberOf MapCache
	 * @param {string} key The key of the value to get.
	 * @returns {*} Returns the entry value.
	 */
	function mapCacheGet(key) {
	  return getMapData(this, key).get(key);
	}

	/**
	 * Checks if a map value for `key` exists.
	 *
	 * @private
	 * @name has
	 * @memberOf MapCache
	 * @param {string} key The key of the entry to check.
	 * @returns {boolean} Returns `true` if an entry for `key` exists, else `false`.
	 */
	function mapCacheHas(key) {
	  return getMapData(this, key).has(key);
	}

	/**
	 * Sets the map `key` to `value`.
	 *
	 * @private
	 * @name set
	 * @memberOf MapCache
	 * @param {string} key The key of the value to set.
	 * @param {*} value The value to set.
	 * @returns {Object} Returns the map cache instance.
	 */
	function mapCacheSet(key, value) {
	  getMapData(this, key).set(key, value);
	  return this;
	}

	// Add methods to `MapCache`.
	MapCache.prototype.clear = mapCacheClear;
	MapCache.prototype['delete'] = mapCacheDelete;
	MapCache.prototype.get = mapCacheGet;
	MapCache.prototype.has = mapCacheHas;
	MapCache.prototype.set = mapCacheSet;

	/**
	 * Creates a stack cache object to store key-value pairs.
	 *
	 * @private
	 * @constructor
	 * @param {Array} [entries] The key-value pairs to cache.
	 */
	function Stack(entries) {
	  this.__data__ = new ListCache(entries);
	}

	/**
	 * Removes all key-value entries from the stack.
	 *
	 * @private
	 * @name clear
	 * @memberOf Stack
	 */
	function stackClear() {
	  this.__data__ = new ListCache;
	}

	/**
	 * Removes `key` and its value from the stack.
	 *
	 * @private
	 * @name delete
	 * @memberOf Stack
	 * @param {string} key The key of the value to remove.
	 * @returns {boolean} Returns `true` if the entry was removed, else `false`.
	 */
	function stackDelete(key) {
	  return this.__data__['delete'](key);
	}

	/**
	 * Gets the stack value for `key`.
	 *
	 * @private
	 * @name get
	 * @memberOf Stack
	 * @param {string} key The key of the value to get.
	 * @returns {*} Returns the entry value.
	 */
	function stackGet(key) {
	  return this.__data__.get(key);
	}

	/**
	 * Checks if a stack value for `key` exists.
	 *
	 * @private
	 * @name has
	 * @memberOf Stack
	 * @param {string} key The key of the entry to check.
	 * @returns {boolean} Returns `true` if an entry for `key` exists, else `false`.
	 */
	function stackHas(key) {
	  return this.__data__.has(key);
	}

	/**
	 * Sets the stack `key` to `value`.
	 *
	 * @private
	 * @name set
	 * @memberOf Stack
	 * @param {string} key The key of the value to set.
	 * @param {*} value The value to set.
	 * @returns {Object} Returns the stack cache instance.
	 */
	function stackSet(key, value) {
	  var cache = this.__data__;
	  if (cache instanceof ListCache) {
	    var pairs = cache.__data__;
	    if (!Map || (pairs.length < LARGE_ARRAY_SIZE - 1)) {
	      pairs.push([key, value]);
	      return this;
	    }
	    cache = this.__data__ = new MapCache(pairs);
	  }
	  cache.set(key, value);
	  return this;
	}

	// Add methods to `Stack`.
	Stack.prototype.clear = stackClear;
	Stack.prototype['delete'] = stackDelete;
	Stack.prototype.get = stackGet;
	Stack.prototype.has = stackHas;
	Stack.prototype.set = stackSet;

	/**
	 * Creates an array of the enumerable property names of the array-like `value`.
	 *
	 * @private
	 * @param {*} value The value to query.
	 * @param {boolean} inherited Specify returning inherited property names.
	 * @returns {Array} Returns the array of property names.
	 */
	function arrayLikeKeys(value, inherited) {
	  // Safari 8.1 makes `arguments.callee` enumerable in strict mode.
	  // Safari 9 makes `arguments.length` enumerable in strict mode.
	  var result = (isArray(value) || isArguments(value))
	    ? baseTimes(value.length, String)
	    : [];

	  var length = result.length,
	      skipIndexes = !!length;

	  for (var key in value) {
	    if ((inherited || hasOwnProperty.call(value, key)) &&
	        !(skipIndexes && (key == 'length' || isIndex(key, length)))) {
	      result.push(key);
	    }
	  }
	  return result;
	}

	/**
	 * Assigns `value` to `key` of `object` if the existing value is not equivalent
	 * using [`SameValueZero`](http://ecma-international.org/ecma-262/7.0/#sec-samevaluezero)
	 * for equality comparisons.
	 *
	 * @private
	 * @param {Object} object The object to modify.
	 * @param {string} key The key of the property to assign.
	 * @param {*} value The value to assign.
	 */
	function assignValue(object, key, value) {
	  var objValue = object[key];
	  if (!(hasOwnProperty.call(object, key) && eq(objValue, value)) ||
	      (value === undefined && !(key in object))) {
	    object[key] = value;
	  }
	}

	/**
	 * Gets the index at which the `key` is found in `array` of key-value pairs.
	 *
	 * @private
	 * @param {Array} array The array to inspect.
	 * @param {*} key The key to search for.
	 * @returns {number} Returns the index of the matched value, else `-1`.
	 */
	function assocIndexOf(array, key) {
	  var length = array.length;
	  while (length--) {
	    if (eq(array[length][0], key)) {
	      return length;
	    }
	  }
	  return -1;
	}

	/**
	 * The base implementation of `_.assign` without support for multiple sources
	 * or `customizer` functions.
	 *
	 * @private
	 * @param {Object} object The destination object.
	 * @param {Object} source The source object.
	 * @returns {Object} Returns `object`.
	 */
	function baseAssign(object, source) {
	  return object && copyObject(source, keys(source), object);
	}

	/**
	 * The base implementation of `_.clone` and `_.cloneDeep` which tracks
	 * traversed objects.
	 *
	 * @private
	 * @param {*} value The value to clone.
	 * @param {boolean} [isDeep] Specify a deep clone.
	 * @param {boolean} [isFull] Specify a clone including symbols.
	 * @param {Function} [customizer] The function to customize cloning.
	 * @param {string} [key] The key of `value`.
	 * @param {Object} [object] The parent object of `value`.
	 * @param {Object} [stack] Tracks traversed objects and their clone counterparts.
	 * @returns {*} Returns the cloned value.
	 */
	function baseClone(value, isDeep, isFull, customizer, key, object, stack) {
	  var result;
	  if (customizer) {
	    result = object ? customizer(value, key, object, stack) : customizer(value);
	  }
	  if (result !== undefined) {
	    return result;
	  }
	  if (!isObject(value)) {
	    return value;
	  }
	  var isArr = isArray(value);
	  if (isArr) {
	    result = initCloneArray(value);
	    if (!isDeep) {
	      return copyArray(value, result);
	    }
	  } else {
	    var tag = getTag(value),
	        isFunc = tag == funcTag || tag == genTag;

	    if (isBuffer(value)) {
	      return cloneBuffer(value, isDeep);
	    }
	    if (tag == objectTag || tag == argsTag || (isFunc && !object)) {
	      if (isHostObject(value)) {
	        return object ? value : {};
	      }
	      result = initCloneObject(isFunc ? {} : value);
	      if (!isDeep) {
	        return copySymbols(value, baseAssign(result, value));
	      }
	    } else {
	      if (!cloneableTags[tag]) {
	        return object ? value : {};
	      }
	      result = initCloneByTag(value, tag, baseClone, isDeep);
	    }
	  }
	  // Check for circular references and return its corresponding clone.
	  stack || (stack = new Stack);
	  var stacked = stack.get(value);
	  if (stacked) {
	    return stacked;
	  }
	  stack.set(value, result);

	  if (!isArr) {
	    var props = isFull ? getAllKeys(value) : keys(value);
	  }
	  arrayEach(props || value, function(subValue, key) {
	    if (props) {
	      key = subValue;
	      subValue = value[key];
	    }
	    // Recursively populate clone (susceptible to call stack limits).
	    assignValue(result, key, baseClone(subValue, isDeep, isFull, customizer, key, value, stack));
	  });
	  return result;
	}

	/**
	 * The base implementation of `_.create` without support for assigning
	 * properties to the created object.
	 *
	 * @private
	 * @param {Object} prototype The object to inherit from.
	 * @returns {Object} Returns the new object.
	 */
	function baseCreate(proto) {
	  return isObject(proto) ? objectCreate(proto) : {};
	}

	/**
	 * The base implementation of `getAllKeys` and `getAllKeysIn` which uses
	 * `keysFunc` and `symbolsFunc` to get the enumerable property names and
	 * symbols of `object`.
	 *
	 * @private
	 * @param {Object} object The object to query.
	 * @param {Function} keysFunc The function to get the keys of `object`.
	 * @param {Function} symbolsFunc The function to get the symbols of `object`.
	 * @returns {Array} Returns the array of property names and symbols.
	 */
	function baseGetAllKeys(object, keysFunc, symbolsFunc) {
	  var result = keysFunc(object);
	  return isArray(object) ? result : arrayPush(result, symbolsFunc(object));
	}

	/**
	 * The base implementation of `getTag`.
	 *
	 * @private
	 * @param {*} value The value to query.
	 * @returns {string} Returns the `toStringTag`.
	 */
	function baseGetTag(value) {
	  return objectToString.call(value);
	}

	/**
	 * The base implementation of `_.isNative` without bad shim checks.
	 *
	 * @private
	 * @param {*} value The value to check.
	 * @returns {boolean} Returns `true` if `value` is a native function,
	 *  else `false`.
	 */
	function baseIsNative(value) {
	  if (!isObject(value) || isMasked(value)) {
	    return false;
	  }
	  var pattern = (isFunction(value) || isHostObject(value)) ? reIsNative : reIsHostCtor;
	  return pattern.test(toSource(value));
	}

	/**
	 * The base implementation of `_.keys` which doesn't treat sparse arrays as dense.
	 *
	 * @private
	 * @param {Object} object The object to query.
	 * @returns {Array} Returns the array of property names.
	 */
	function baseKeys(object) {
	  if (!isPrototype(object)) {
	    return nativeKeys(object);
	  }
	  var result = [];
	  for (var key in Object(object)) {
	    if (hasOwnProperty.call(object, key) && key != 'constructor') {
	      result.push(key);
	    }
	  }
	  return result;
	}

	/**
	 * Creates a clone of  `buffer`.
	 *
	 * @private
	 * @param {Buffer} buffer The buffer to clone.
	 * @param {boolean} [isDeep] Specify a deep clone.
	 * @returns {Buffer} Returns the cloned buffer.
	 */
	function cloneBuffer(buffer, isDeep) {
	  if (isDeep) {
	    return buffer.slice();
	  }
	  var result = new buffer.constructor(buffer.length);
	  buffer.copy(result);
	  return result;
	}

	/**
	 * Creates a clone of `arrayBuffer`.
	 *
	 * @private
	 * @param {ArrayBuffer} arrayBuffer The array buffer to clone.
	 * @returns {ArrayBuffer} Returns the cloned array buffer.
	 */
	function cloneArrayBuffer(arrayBuffer) {
	  var result = new arrayBuffer.constructor(arrayBuffer.byteLength);
	  new Uint8Array(result).set(new Uint8Array(arrayBuffer));
	  return result;
	}

	/**
	 * Creates a clone of `dataView`.
	 *
	 * @private
	 * @param {Object} dataView The data view to clone.
	 * @param {boolean} [isDeep] Specify a deep clone.
	 * @returns {Object} Returns the cloned data view.
	 */
	function cloneDataView(dataView, isDeep) {
	  var buffer = isDeep ? cloneArrayBuffer(dataView.buffer) : dataView.buffer;
	  return new dataView.constructor(buffer, dataView.byteOffset, dataView.byteLength);
	}

	/**
	 * Creates a clone of `map`.
	 *
	 * @private
	 * @param {Object} map The map to clone.
	 * @param {Function} cloneFunc The function to clone values.
	 * @param {boolean} [isDeep] Specify a deep clone.
	 * @returns {Object} Returns the cloned map.
	 */
	function cloneMap(map, isDeep, cloneFunc) {
	  var array = isDeep ? cloneFunc(mapToArray(map), true) : mapToArray(map);
	  return arrayReduce(array, addMapEntry, new map.constructor);
	}

	/**
	 * Creates a clone of `regexp`.
	 *
	 * @private
	 * @param {Object} regexp The regexp to clone.
	 * @returns {Object} Returns the cloned regexp.
	 */
	function cloneRegExp(regexp) {
	  var result = new regexp.constructor(regexp.source, reFlags.exec(regexp));
	  result.lastIndex = regexp.lastIndex;
	  return result;
	}

	/**
	 * Creates a clone of `set`.
	 *
	 * @private
	 * @param {Object} set The set to clone.
	 * @param {Function} cloneFunc The function to clone values.
	 * @param {boolean} [isDeep] Specify a deep clone.
	 * @returns {Object} Returns the cloned set.
	 */
	function cloneSet(set, isDeep, cloneFunc) {
	  var array = isDeep ? cloneFunc(setToArray(set), true) : setToArray(set);
	  return arrayReduce(array, addSetEntry, new set.constructor);
	}

	/**
	 * Creates a clone of the `symbol` object.
	 *
	 * @private
	 * @param {Object} symbol The symbol object to clone.
	 * @returns {Object} Returns the cloned symbol object.
	 */
	function cloneSymbol(symbol) {
	  return symbolValueOf ? Object(symbolValueOf.call(symbol)) : {};
	}

	/**
	 * Creates a clone of `typedArray`.
	 *
	 * @private
	 * @param {Object} typedArray The typed array to clone.
	 * @param {boolean} [isDeep] Specify a deep clone.
	 * @returns {Object} Returns the cloned typed array.
	 */
	function cloneTypedArray(typedArray, isDeep) {
	  var buffer = isDeep ? cloneArrayBuffer(typedArray.buffer) : typedArray.buffer;
	  return new typedArray.constructor(buffer, typedArray.byteOffset, typedArray.length);
	}

	/**
	 * Copies the values of `source` to `array`.
	 *
	 * @private
	 * @param {Array} source The array to copy values from.
	 * @param {Array} [array=[]] The array to copy values to.
	 * @returns {Array} Returns `array`.
	 */
	function copyArray(source, array) {
	  var index = -1,
	      length = source.length;

	  array || (array = Array(length));
	  while (++index < length) {
	    array[index] = source[index];
	  }
	  return array;
	}

	/**
	 * Copies properties of `source` to `object`.
	 *
	 * @private
	 * @param {Object} source The object to copy properties from.
	 * @param {Array} props The property identifiers to copy.
	 * @param {Object} [object={}] The object to copy properties to.
	 * @param {Function} [customizer] The function to customize copied values.
	 * @returns {Object} Returns `object`.
	 */
	function copyObject(source, props, object, customizer) {
	  object || (object = {});

	  var index = -1,
	      length = props.length;

	  while (++index < length) {
	    var key = props[index];

	    var newValue = customizer
	      ? customizer(object[key], source[key], key, object, source)
	      : undefined;

	    assignValue(object, key, newValue === undefined ? source[key] : newValue);
	  }
	  return object;
	}

	/**
	 * Copies own symbol properties of `source` to `object`.
	 *
	 * @private
	 * @param {Object} source The object to copy symbols from.
	 * @param {Object} [object={}] The object to copy symbols to.
	 * @returns {Object} Returns `object`.
	 */
	function copySymbols(source, object) {
	  return copyObject(source, getSymbols(source), object);
	}

	/**
	 * Creates an array of own enumerable property names and symbols of `object`.
	 *
	 * @private
	 * @param {Object} object The object to query.
	 * @returns {Array} Returns the array of property names and symbols.
	 */
	function getAllKeys(object) {
	  return baseGetAllKeys(object, keys, getSymbols);
	}

	/**
	 * Gets the data for `map`.
	 *
	 * @private
	 * @param {Object} map The map to query.
	 * @param {string} key The reference key.
	 * @returns {*} Returns the map data.
	 */
	function getMapData(map, key) {
	  var data = map.__data__;
	  return isKeyable(key)
	    ? data[typeof key == 'string' ? 'string' : 'hash']
	    : data.map;
	}

	/**
	 * Gets the native function at `key` of `object`.
	 *
	 * @private
	 * @param {Object} object The object to query.
	 * @param {string} key The key of the method to get.
	 * @returns {*} Returns the function if it's native, else `undefined`.
	 */
	function getNative(object, key) {
	  var value = getValue(object, key);
	  return baseIsNative(value) ? value : undefined;
	}

	/**
	 * Creates an array of the own enumerable symbol properties of `object`.
	 *
	 * @private
	 * @param {Object} object The object to query.
	 * @returns {Array} Returns the array of symbols.
	 */
	var getSymbols = nativeGetSymbols ? overArg(nativeGetSymbols, Object) : stubArray;

	/**
	 * Gets the `toStringTag` of `value`.
	 *
	 * @private
	 * @param {*} value The value to query.
	 * @returns {string} Returns the `toStringTag`.
	 */
	var getTag = baseGetTag;

	// Fallback for data views, maps, sets, and weak maps in IE 11,
	// for data views in Edge < 14, and promises in Node.js.
	if ((DataView && getTag(new DataView(new ArrayBuffer(1))) != dataViewTag) ||
	    (Map && getTag(new Map) != mapTag) ||
	    (Promise && getTag(Promise.resolve()) != promiseTag) ||
	    (Set && getTag(new Set) != setTag) ||
	    (WeakMap && getTag(new WeakMap) != weakMapTag)) {
	  getTag = function(value) {
	    var result = objectToString.call(value),
	        Ctor = result == objectTag ? value.constructor : undefined,
	        ctorString = Ctor ? toSource(Ctor) : undefined;

	    if (ctorString) {
	      switch (ctorString) {
	        case dataViewCtorString: return dataViewTag;
	        case mapCtorString: return mapTag;
	        case promiseCtorString: return promiseTag;
	        case setCtorString: return setTag;
	        case weakMapCtorString: return weakMapTag;
	      }
	    }
	    return result;
	  };
	}

	/**
	 * Initializes an array clone.
	 *
	 * @private
	 * @param {Array} array The array to clone.
	 * @returns {Array} Returns the initialized clone.
	 */
	function initCloneArray(array) {
	  var length = array.length,
	      result = array.constructor(length);

	  // Add properties assigned by `RegExp#exec`.
	  if (length && typeof array[0] == 'string' && hasOwnProperty.call(array, 'index')) {
	    result.index = array.index;
	    result.input = array.input;
	  }
	  return result;
	}

	/**
	 * Initializes an object clone.
	 *
	 * @private
	 * @param {Object} object The object to clone.
	 * @returns {Object} Returns the initialized clone.
	 */
	function initCloneObject(object) {
	  return (typeof object.constructor == 'function' && !isPrototype(object))
	    ? baseCreate(getPrototype(object))
	    : {};
	}

	/**
	 * Initializes an object clone based on its `toStringTag`.
	 *
	 * **Note:** This function only supports cloning values with tags of
	 * `Boolean`, `Date`, `Error`, `Number`, `RegExp`, or `String`.
	 *
	 * @private
	 * @param {Object} object The object to clone.
	 * @param {string} tag The `toStringTag` of the object to clone.
	 * @param {Function} cloneFunc The function to clone values.
	 * @param {boolean} [isDeep] Specify a deep clone.
	 * @returns {Object} Returns the initialized clone.
	 */
	function initCloneByTag(object, tag, cloneFunc, isDeep) {
	  var Ctor = object.constructor;
	  switch (tag) {
	    case arrayBufferTag:
	      return cloneArrayBuffer(object);

	    case boolTag:
	    case dateTag:
	      return new Ctor(+object);

	    case dataViewTag:
	      return cloneDataView(object, isDeep);

	    case float32Tag: case float64Tag:
	    case int8Tag: case int16Tag: case int32Tag:
	    case uint8Tag: case uint8ClampedTag: case uint16Tag: case uint32Tag:
	      return cloneTypedArray(object, isDeep);

	    case mapTag:
	      return cloneMap(object, isDeep, cloneFunc);

	    case numberTag:
	    case stringTag:
	      return new Ctor(object);

	    case regexpTag:
	      return cloneRegExp(object);

	    case setTag:
	      return cloneSet(object, isDeep, cloneFunc);

	    case symbolTag:
	      return cloneSymbol(object);
	  }
	}

	/**
	 * Checks if `value` is a valid array-like index.
	 *
	 * @private
	 * @param {*} value The value to check.
	 * @param {number} [length=MAX_SAFE_INTEGER] The upper bounds of a valid index.
	 * @returns {boolean} Returns `true` if `value` is a valid index, else `false`.
	 */
	function isIndex(value, length) {
	  length = length == null ? MAX_SAFE_INTEGER : length;
	  return !!length &&
	    (typeof value == 'number' || reIsUint.test(value)) &&
	    (value > -1 && value % 1 == 0 && value < length);
	}

	/**
	 * Checks if `value` is suitable for use as unique object key.
	 *
	 * @private
	 * @param {*} value The value to check.
	 * @returns {boolean} Returns `true` if `value` is suitable, else `false`.
	 */
	function isKeyable(value) {
	  var type = typeof value;
	  return (type == 'string' || type == 'number' || type == 'symbol' || type == 'boolean')
	    ? (value !== '__proto__')
	    : (value === null);
	}

	/**
	 * Checks if `func` has its source masked.
	 *
	 * @private
	 * @param {Function} func The function to check.
	 * @returns {boolean} Returns `true` if `func` is masked, else `false`.
	 */
	function isMasked(func) {
	  return !!maskSrcKey && (maskSrcKey in func);
	}

	/**
	 * Checks if `value` is likely a prototype object.
	 *
	 * @private
	 * @param {*} value The value to check.
	 * @returns {boolean} Returns `true` if `value` is a prototype, else `false`.
	 */
	function isPrototype(value) {
	  var Ctor = value && value.constructor,
	      proto = (typeof Ctor == 'function' && Ctor.prototype) || objectProto;

	  return value === proto;
	}

	/**
	 * Converts `func` to its source code.
	 *
	 * @private
	 * @param {Function} func The function to process.
	 * @returns {string} Returns the source code.
	 */
	function toSource(func) {
	  if (func != null) {
	    try {
	      return funcToString.call(func);
	    } catch (e) {}
	    try {
	      return (func + '');
	    } catch (e) {}
	  }
	  return '';
	}

	/**
	 * This method is like `_.clone` except that it recursively clones `value`.
	 *
	 * @static
	 * @memberOf _
	 * @since 1.0.0
	 * @category Lang
	 * @param {*} value The value to recursively clone.
	 * @returns {*} Returns the deep cloned value.
	 * @see _.clone
	 * @example
	 *
	 * var objects = [{ 'a': 1 }, { 'b': 2 }];
	 *
	 * var deep = _.cloneDeep(objects);
	 * console.log(deep[0] === objects[0]);
	 * // => false
	 */
	function cloneDeep(value) {
	  return baseClone(value, true, true);
	}

	/**
	 * Performs a
	 * [`SameValueZero`](http://ecma-international.org/ecma-262/7.0/#sec-samevaluezero)
	 * comparison between two values to determine if they are equivalent.
	 *
	 * @static
	 * @memberOf _
	 * @since 4.0.0
	 * @category Lang
	 * @param {*} value The value to compare.
	 * @param {*} other The other value to compare.
	 * @returns {boolean} Returns `true` if the values are equivalent, else `false`.
	 * @example
	 *
	 * var object = { 'a': 1 };
	 * var other = { 'a': 1 };
	 *
	 * _.eq(object, object);
	 * // => true
	 *
	 * _.eq(object, other);
	 * // => false
	 *
	 * _.eq('a', 'a');
	 * // => true
	 *
	 * _.eq('a', Object('a'));
	 * // => false
	 *
	 * _.eq(NaN, NaN);
	 * // => true
	 */
	function eq(value, other) {
	  return value === other || (value !== value && other !== other);
	}

	/**
	 * Checks if `value` is likely an `arguments` object.
	 *
	 * @static
	 * @memberOf _
	 * @since 0.1.0
	 * @category Lang
	 * @param {*} value The value to check.
	 * @returns {boolean} Returns `true` if `value` is an `arguments` object,
	 *  else `false`.
	 * @example
	 *
	 * _.isArguments(function() { return arguments; }());
	 * // => true
	 *
	 * _.isArguments([1, 2, 3]);
	 * // => false
	 */
	function isArguments(value) {
	  // Safari 8.1 makes `arguments.callee` enumerable in strict mode.
	  return isArrayLikeObject(value) && hasOwnProperty.call(value, 'callee') &&
	    (!propertyIsEnumerable.call(value, 'callee') || objectToString.call(value) == argsTag);
	}

	/**
	 * Checks if `value` is classified as an `Array` object.
	 *
	 * @static
	 * @memberOf _
	 * @since 0.1.0
	 * @category Lang
	 * @param {*} value The value to check.
	 * @returns {boolean} Returns `true` if `value` is an array, else `false`.
	 * @example
	 *
	 * _.isArray([1, 2, 3]);
	 * // => true
	 *
	 * _.isArray(document.body.children);
	 * // => false
	 *
	 * _.isArray('abc');
	 * // => false
	 *
	 * _.isArray(_.noop);
	 * // => false
	 */
	var isArray = Array.isArray;

	/**
	 * Checks if `value` is array-like. A value is considered array-like if it's
	 * not a function and has a `value.length` that's an integer greater than or
	 * equal to `0` and less than or equal to `Number.MAX_SAFE_INTEGER`.
	 *
	 * @static
	 * @memberOf _
	 * @since 4.0.0
	 * @category Lang
	 * @param {*} value The value to check.
	 * @returns {boolean} Returns `true` if `value` is array-like, else `false`.
	 * @example
	 *
	 * _.isArrayLike([1, 2, 3]);
	 * // => true
	 *
	 * _.isArrayLike(document.body.children);
	 * // => true
	 *
	 * _.isArrayLike('abc');
	 * // => true
	 *
	 * _.isArrayLike(_.noop);
	 * // => false
	 */
	function isArrayLike(value) {
	  return value != null && isLength(value.length) && !isFunction(value);
	}

	/**
	 * This method is like `_.isArrayLike` except that it also checks if `value`
	 * is an object.
	 *
	 * @static
	 * @memberOf _
	 * @since 4.0.0
	 * @category Lang
	 * @param {*} value The value to check.
	 * @returns {boolean} Returns `true` if `value` is an array-like object,
	 *  else `false`.
	 * @example
	 *
	 * _.isArrayLikeObject([1, 2, 3]);
	 * // => true
	 *
	 * _.isArrayLikeObject(document.body.children);
	 * // => true
	 *
	 * _.isArrayLikeObject('abc');
	 * // => false
	 *
	 * _.isArrayLikeObject(_.noop);
	 * // => false
	 */
	function isArrayLikeObject(value) {
	  return isObjectLike(value) && isArrayLike(value);
	}

	/**
	 * Checks if `value` is a buffer.
	 *
	 * @static
	 * @memberOf _
	 * @since 4.3.0
	 * @category Lang
	 * @param {*} value The value to check.
	 * @returns {boolean} Returns `true` if `value` is a buffer, else `false`.
	 * @example
	 *
	 * _.isBuffer(new Buffer(2));
	 * // => true
	 *
	 * _.isBuffer(new Uint8Array(2));
	 * // => false
	 */
	var isBuffer = nativeIsBuffer || stubFalse;

	/**
	 * Checks if `value` is classified as a `Function` object.
	 *
	 * @static
	 * @memberOf _
	 * @since 0.1.0
	 * @category Lang
	 * @param {*} value The value to check.
	 * @returns {boolean} Returns `true` if `value` is a function, else `false`.
	 * @example
	 *
	 * _.isFunction(_);
	 * // => true
	 *
	 * _.isFunction(/abc/);
	 * // => false
	 */
	function isFunction(value) {
	  // The use of `Object#toString` avoids issues with the `typeof` operator
	  // in Safari 8-9 which returns 'object' for typed array and other constructors.
	  var tag = isObject(value) ? objectToString.call(value) : '';
	  return tag == funcTag || tag == genTag;
	}

	/**
	 * Checks if `value` is a valid array-like length.
	 *
	 * **Note:** This method is loosely based on
	 * [`ToLength`](http://ecma-international.org/ecma-262/7.0/#sec-tolength).
	 *
	 * @static
	 * @memberOf _
	 * @since 4.0.0
	 * @category Lang
	 * @param {*} value The value to check.
	 * @returns {boolean} Returns `true` if `value` is a valid length, else `false`.
	 * @example
	 *
	 * _.isLength(3);
	 * // => true
	 *
	 * _.isLength(Number.MIN_VALUE);
	 * // => false
	 *
	 * _.isLength(Infinity);
	 * // => false
	 *
	 * _.isLength('3');
	 * // => false
	 */
	function isLength(value) {
	  return typeof value == 'number' &&
	    value > -1 && value % 1 == 0 && value <= MAX_SAFE_INTEGER;
	}

	/**
	 * Checks if `value` is the
	 * [language type](http://www.ecma-international.org/ecma-262/7.0/#sec-ecmascript-language-types)
	 * of `Object`. (e.g. arrays, functions, objects, regexes, `new Number(0)`, and `new String('')`)
	 *
	 * @static
	 * @memberOf _
	 * @since 0.1.0
	 * @category Lang
	 * @param {*} value The value to check.
	 * @returns {boolean} Returns `true` if `value` is an object, else `false`.
	 * @example
	 *
	 * _.isObject({});
	 * // => true
	 *
	 * _.isObject([1, 2, 3]);
	 * // => true
	 *
	 * _.isObject(_.noop);
	 * // => true
	 *
	 * _.isObject(null);
	 * // => false
	 */
	function isObject(value) {
	  var type = typeof value;
	  return !!value && (type == 'object' || type == 'function');
	}

	/**
	 * Checks if `value` is object-like. A value is object-like if it's not `null`
	 * and has a `typeof` result of "object".
	 *
	 * @static
	 * @memberOf _
	 * @since 4.0.0
	 * @category Lang
	 * @param {*} value The value to check.
	 * @returns {boolean} Returns `true` if `value` is object-like, else `false`.
	 * @example
	 *
	 * _.isObjectLike({});
	 * // => true
	 *
	 * _.isObjectLike([1, 2, 3]);
	 * // => true
	 *
	 * _.isObjectLike(_.noop);
	 * // => false
	 *
	 * _.isObjectLike(null);
	 * // => false
	 */
	function isObjectLike(value) {
	  return !!value && typeof value == 'object';
	}

	/**
	 * Creates an array of the own enumerable property names of `object`.
	 *
	 * **Note:** Non-object values are coerced to objects. See the
	 * [ES spec](http://ecma-international.org/ecma-262/7.0/#sec-object.keys)
	 * for more details.
	 *
	 * @static
	 * @since 0.1.0
	 * @memberOf _
	 * @category Object
	 * @param {Object} object The object to query.
	 * @returns {Array} Returns the array of property names.
	 * @example
	 *
	 * function Foo() {
	 *   this.a = 1;
	 *   this.b = 2;
	 * }
	 *
	 * Foo.prototype.c = 3;
	 *
	 * _.keys(new Foo);
	 * // => ['a', 'b'] (iteration order is not guaranteed)
	 *
	 * _.keys('hi');
	 * // => ['0', '1']
	 */
	function keys(object) {
	  return isArrayLike(object) ? arrayLikeKeys(object) : baseKeys(object);
	}

	/**
	 * This method returns a new empty array.
	 *
	 * @static
	 * @memberOf _
	 * @since 4.13.0
	 * @category Util
	 * @returns {Array} Returns the new empty array.
	 * @example
	 *
	 * var arrays = _.times(2, _.stubArray);
	 *
	 * console.log(arrays);
	 * // => [[], []]
	 *
	 * console.log(arrays[0] === arrays[1]);
	 * // => false
	 */
	function stubArray() {
	  return [];
	}

	/**
	 * This method returns `false`.
	 *
	 * @static
	 * @memberOf _
	 * @since 4.13.0
	 * @category Util
	 * @returns {boolean} Returns `false`.
	 * @example
	 *
	 * _.times(2, _.stubFalse);
	 * // => [false, false]
	 */
	function stubFalse() {
	  return false;
	}

	module.exports = cloneDeep;
	});

	/**
	 * Lodash (Custom Build) <https://lodash.com/>
	 * Build: `lodash modularize exports="npm" -o ./`
	 * Copyright JS Foundation and other contributors <https://js.foundation/>
	 * Released under MIT license <https://lodash.com/license>
	 * Based on Underscore.js 1.8.3 <http://underscorejs.org/LICENSE>
	 * Copyright Jeremy Ashkenas, DocumentCloud and Investigative Reporters & Editors
	 */

	var lodash_isequal = createCommonjsModule(function (module, exports) {
	/** Used as the size to enable large array optimizations. */
	var LARGE_ARRAY_SIZE = 200;

	/** Used to stand-in for `undefined` hash values. */
	var HASH_UNDEFINED = '__lodash_hash_undefined__';

	/** Used to compose bitmasks for value comparisons. */
	var COMPARE_PARTIAL_FLAG = 1,
	    COMPARE_UNORDERED_FLAG = 2;

	/** Used as references for various `Number` constants. */
	var MAX_SAFE_INTEGER = 9007199254740991;

	/** `Object#toString` result references. */
	var argsTag = '[object Arguments]',
	    arrayTag = '[object Array]',
	    asyncTag = '[object AsyncFunction]',
	    boolTag = '[object Boolean]',
	    dateTag = '[object Date]',
	    errorTag = '[object Error]',
	    funcTag = '[object Function]',
	    genTag = '[object GeneratorFunction]',
	    mapTag = '[object Map]',
	    numberTag = '[object Number]',
	    nullTag = '[object Null]',
	    objectTag = '[object Object]',
	    promiseTag = '[object Promise]',
	    proxyTag = '[object Proxy]',
	    regexpTag = '[object RegExp]',
	    setTag = '[object Set]',
	    stringTag = '[object String]',
	    symbolTag = '[object Symbol]',
	    undefinedTag = '[object Undefined]',
	    weakMapTag = '[object WeakMap]';

	var arrayBufferTag = '[object ArrayBuffer]',
	    dataViewTag = '[object DataView]',
	    float32Tag = '[object Float32Array]',
	    float64Tag = '[object Float64Array]',
	    int8Tag = '[object Int8Array]',
	    int16Tag = '[object Int16Array]',
	    int32Tag = '[object Int32Array]',
	    uint8Tag = '[object Uint8Array]',
	    uint8ClampedTag = '[object Uint8ClampedArray]',
	    uint16Tag = '[object Uint16Array]',
	    uint32Tag = '[object Uint32Array]';

	/**
	 * Used to match `RegExp`
	 * [syntax characters](http://ecma-international.org/ecma-262/7.0/#sec-patterns).
	 */
	var reRegExpChar = /[\\^$.*+?()[\]{}|]/g;

	/** Used to detect host constructors (Safari). */
	var reIsHostCtor = /^\[object .+?Constructor\]$/;

	/** Used to detect unsigned integer values. */
	var reIsUint = /^(?:0|[1-9]\d*)$/;

	/** Used to identify `toStringTag` values of typed arrays. */
	var typedArrayTags = {};
	typedArrayTags[float32Tag] = typedArrayTags[float64Tag] =
	typedArrayTags[int8Tag] = typedArrayTags[int16Tag] =
	typedArrayTags[int32Tag] = typedArrayTags[uint8Tag] =
	typedArrayTags[uint8ClampedTag] = typedArrayTags[uint16Tag] =
	typedArrayTags[uint32Tag] = true;
	typedArrayTags[argsTag] = typedArrayTags[arrayTag] =
	typedArrayTags[arrayBufferTag] = typedArrayTags[boolTag] =
	typedArrayTags[dataViewTag] = typedArrayTags[dateTag] =
	typedArrayTags[errorTag] = typedArrayTags[funcTag] =
	typedArrayTags[mapTag] = typedArrayTags[numberTag] =
	typedArrayTags[objectTag] = typedArrayTags[regexpTag] =
	typedArrayTags[setTag] = typedArrayTags[stringTag] =
	typedArrayTags[weakMapTag] = false;

	/** Detect free variable `global` from Node.js. */
	var freeGlobal = typeof commonjsGlobal == 'object' && commonjsGlobal && commonjsGlobal.Object === Object && commonjsGlobal;

	/** Detect free variable `self`. */
	var freeSelf = typeof self == 'object' && self && self.Object === Object && self;

	/** Used as a reference to the global object. */
	var root = freeGlobal || freeSelf || Function('return this')();

	/** Detect free variable `exports`. */
	var freeExports = exports && !exports.nodeType && exports;

	/** Detect free variable `module`. */
	var freeModule = freeExports && 'object' == 'object' && module && !module.nodeType && module;

	/** Detect the popular CommonJS extension `module.exports`. */
	var moduleExports = freeModule && freeModule.exports === freeExports;

	/** Detect free variable `process` from Node.js. */
	var freeProcess = moduleExports && freeGlobal.process;

	/** Used to access faster Node.js helpers. */
	var nodeUtil = (function() {
	  try {
	    return freeProcess && freeProcess.binding && freeProcess.binding('util');
	  } catch (e) {}
	}());

	/* Node.js helper references. */
	var nodeIsTypedArray = nodeUtil && nodeUtil.isTypedArray;

	/**
	 * A specialized version of `_.filter` for arrays without support for
	 * iteratee shorthands.
	 *
	 * @private
	 * @param {Array} [array] The array to iterate over.
	 * @param {Function} predicate The function invoked per iteration.
	 * @returns {Array} Returns the new filtered array.
	 */
	function arrayFilter(array, predicate) {
	  var index = -1,
	      length = array == null ? 0 : array.length,
	      resIndex = 0,
	      result = [];

	  while (++index < length) {
	    var value = array[index];
	    if (predicate(value, index, array)) {
	      result[resIndex++] = value;
	    }
	  }
	  return result;
	}

	/**
	 * Appends the elements of `values` to `array`.
	 *
	 * @private
	 * @param {Array} array The array to modify.
	 * @param {Array} values The values to append.
	 * @returns {Array} Returns `array`.
	 */
	function arrayPush(array, values) {
	  var index = -1,
	      length = values.length,
	      offset = array.length;

	  while (++index < length) {
	    array[offset + index] = values[index];
	  }
	  return array;
	}

	/**
	 * A specialized version of `_.some` for arrays without support for iteratee
	 * shorthands.
	 *
	 * @private
	 * @param {Array} [array] The array to iterate over.
	 * @param {Function} predicate The function invoked per iteration.
	 * @returns {boolean} Returns `true` if any element passes the predicate check,
	 *  else `false`.
	 */
	function arraySome(array, predicate) {
	  var index = -1,
	      length = array == null ? 0 : array.length;

	  while (++index < length) {
	    if (predicate(array[index], index, array)) {
	      return true;
	    }
	  }
	  return false;
	}

	/**
	 * The base implementation of `_.times` without support for iteratee shorthands
	 * or max array length checks.
	 *
	 * @private
	 * @param {number} n The number of times to invoke `iteratee`.
	 * @param {Function} iteratee The function invoked per iteration.
	 * @returns {Array} Returns the array of results.
	 */
	function baseTimes(n, iteratee) {
	  var index = -1,
	      result = Array(n);

	  while (++index < n) {
	    result[index] = iteratee(index);
	  }
	  return result;
	}

	/**
	 * The base implementation of `_.unary` without support for storing metadata.
	 *
	 * @private
	 * @param {Function} func The function to cap arguments for.
	 * @returns {Function} Returns the new capped function.
	 */
	function baseUnary(func) {
	  return function(value) {
	    return func(value);
	  };
	}

	/**
	 * Checks if a `cache` value for `key` exists.
	 *
	 * @private
	 * @param {Object} cache The cache to query.
	 * @param {string} key The key of the entry to check.
	 * @returns {boolean} Returns `true` if an entry for `key` exists, else `false`.
	 */
	function cacheHas(cache, key) {
	  return cache.has(key);
	}

	/**
	 * Gets the value at `key` of `object`.
	 *
	 * @private
	 * @param {Object} [object] The object to query.
	 * @param {string} key The key of the property to get.
	 * @returns {*} Returns the property value.
	 */
	function getValue(object, key) {
	  return object == null ? undefined : object[key];
	}

	/**
	 * Converts `map` to its key-value pairs.
	 *
	 * @private
	 * @param {Object} map The map to convert.
	 * @returns {Array} Returns the key-value pairs.
	 */
	function mapToArray(map) {
	  var index = -1,
	      result = Array(map.size);

	  map.forEach(function(value, key) {
	    result[++index] = [key, value];
	  });
	  return result;
	}

	/**
	 * Creates a unary function that invokes `func` with its argument transformed.
	 *
	 * @private
	 * @param {Function} func The function to wrap.
	 * @param {Function} transform The argument transform.
	 * @returns {Function} Returns the new function.
	 */
	function overArg(func, transform) {
	  return function(arg) {
	    return func(transform(arg));
	  };
	}

	/**
	 * Converts `set` to an array of its values.
	 *
	 * @private
	 * @param {Object} set The set to convert.
	 * @returns {Array} Returns the values.
	 */
	function setToArray(set) {
	  var index = -1,
	      result = Array(set.size);

	  set.forEach(function(value) {
	    result[++index] = value;
	  });
	  return result;
	}

	/** Used for built-in method references. */
	var arrayProto = Array.prototype,
	    funcProto = Function.prototype,
	    objectProto = Object.prototype;

	/** Used to detect overreaching core-js shims. */
	var coreJsData = root['__core-js_shared__'];

	/** Used to resolve the decompiled source of functions. */
	var funcToString = funcProto.toString;

	/** Used to check objects for own properties. */
	var hasOwnProperty = objectProto.hasOwnProperty;

	/** Used to detect methods masquerading as native. */
	var maskSrcKey = (function() {
	  var uid = /[^.]+$/.exec(coreJsData && coreJsData.keys && coreJsData.keys.IE_PROTO || '');
	  return uid ? ('Symbol(src)_1.' + uid) : '';
	}());

	/**
	 * Used to resolve the
	 * [`toStringTag`](http://ecma-international.org/ecma-262/7.0/#sec-object.prototype.tostring)
	 * of values.
	 */
	var nativeObjectToString = objectProto.toString;

	/** Used to detect if a method is native. */
	var reIsNative = RegExp('^' +
	  funcToString.call(hasOwnProperty).replace(reRegExpChar, '\\$&')
	  .replace(/hasOwnProperty|(function).*?(?=\\\()| for .+?(?=\\\])/g, '$1.*?') + '$'
	);

	/** Built-in value references. */
	var Buffer = moduleExports ? root.Buffer : undefined,
	    Symbol = root.Symbol,
	    Uint8Array = root.Uint8Array,
	    propertyIsEnumerable = objectProto.propertyIsEnumerable,
	    splice = arrayProto.splice,
	    symToStringTag = Symbol ? Symbol.toStringTag : undefined;

	/* Built-in method references for those with the same name as other `lodash` methods. */
	var nativeGetSymbols = Object.getOwnPropertySymbols,
	    nativeIsBuffer = Buffer ? Buffer.isBuffer : undefined,
	    nativeKeys = overArg(Object.keys, Object);

	/* Built-in method references that are verified to be native. */
	var DataView = getNative(root, 'DataView'),
	    Map = getNative(root, 'Map'),
	    Promise = getNative(root, 'Promise'),
	    Set = getNative(root, 'Set'),
	    WeakMap = getNative(root, 'WeakMap'),
	    nativeCreate = getNative(Object, 'create');

	/** Used to detect maps, sets, and weakmaps. */
	var dataViewCtorString = toSource(DataView),
	    mapCtorString = toSource(Map),
	    promiseCtorString = toSource(Promise),
	    setCtorString = toSource(Set),
	    weakMapCtorString = toSource(WeakMap);

	/** Used to convert symbols to primitives and strings. */
	var symbolProto = Symbol ? Symbol.prototype : undefined,
	    symbolValueOf = symbolProto ? symbolProto.valueOf : undefined;

	/**
	 * Creates a hash object.
	 *
	 * @private
	 * @constructor
	 * @param {Array} [entries] The key-value pairs to cache.
	 */
	function Hash(entries) {
	  var index = -1,
	      length = entries == null ? 0 : entries.length;

	  this.clear();
	  while (++index < length) {
	    var entry = entries[index];
	    this.set(entry[0], entry[1]);
	  }
	}

	/**
	 * Removes all key-value entries from the hash.
	 *
	 * @private
	 * @name clear
	 * @memberOf Hash
	 */
	function hashClear() {
	  this.__data__ = nativeCreate ? nativeCreate(null) : {};
	  this.size = 0;
	}

	/**
	 * Removes `key` and its value from the hash.
	 *
	 * @private
	 * @name delete
	 * @memberOf Hash
	 * @param {Object} hash The hash to modify.
	 * @param {string} key The key of the value to remove.
	 * @returns {boolean} Returns `true` if the entry was removed, else `false`.
	 */
	function hashDelete(key) {
	  var result = this.has(key) && delete this.__data__[key];
	  this.size -= result ? 1 : 0;
	  return result;
	}

	/**
	 * Gets the hash value for `key`.
	 *
	 * @private
	 * @name get
	 * @memberOf Hash
	 * @param {string} key The key of the value to get.
	 * @returns {*} Returns the entry value.
	 */
	function hashGet(key) {
	  var data = this.__data__;
	  if (nativeCreate) {
	    var result = data[key];
	    return result === HASH_UNDEFINED ? undefined : result;
	  }
	  return hasOwnProperty.call(data, key) ? data[key] : undefined;
	}

	/**
	 * Checks if a hash value for `key` exists.
	 *
	 * @private
	 * @name has
	 * @memberOf Hash
	 * @param {string} key The key of the entry to check.
	 * @returns {boolean} Returns `true` if an entry for `key` exists, else `false`.
	 */
	function hashHas(key) {
	  var data = this.__data__;
	  return nativeCreate ? (data[key] !== undefined) : hasOwnProperty.call(data, key);
	}

	/**
	 * Sets the hash `key` to `value`.
	 *
	 * @private
	 * @name set
	 * @memberOf Hash
	 * @param {string} key The key of the value to set.
	 * @param {*} value The value to set.
	 * @returns {Object} Returns the hash instance.
	 */
	function hashSet(key, value) {
	  var data = this.__data__;
	  this.size += this.has(key) ? 0 : 1;
	  data[key] = (nativeCreate && value === undefined) ? HASH_UNDEFINED : value;
	  return this;
	}

	// Add methods to `Hash`.
	Hash.prototype.clear = hashClear;
	Hash.prototype['delete'] = hashDelete;
	Hash.prototype.get = hashGet;
	Hash.prototype.has = hashHas;
	Hash.prototype.set = hashSet;

	/**
	 * Creates an list cache object.
	 *
	 * @private
	 * @constructor
	 * @param {Array} [entries] The key-value pairs to cache.
	 */
	function ListCache(entries) {
	  var index = -1,
	      length = entries == null ? 0 : entries.length;

	  this.clear();
	  while (++index < length) {
	    var entry = entries[index];
	    this.set(entry[0], entry[1]);
	  }
	}

	/**
	 * Removes all key-value entries from the list cache.
	 *
	 * @private
	 * @name clear
	 * @memberOf ListCache
	 */
	function listCacheClear() {
	  this.__data__ = [];
	  this.size = 0;
	}

	/**
	 * Removes `key` and its value from the list cache.
	 *
	 * @private
	 * @name delete
	 * @memberOf ListCache
	 * @param {string} key The key of the value to remove.
	 * @returns {boolean} Returns `true` if the entry was removed, else `false`.
	 */
	function listCacheDelete(key) {
	  var data = this.__data__,
	      index = assocIndexOf(data, key);

	  if (index < 0) {
	    return false;
	  }
	  var lastIndex = data.length - 1;
	  if (index == lastIndex) {
	    data.pop();
	  } else {
	    splice.call(data, index, 1);
	  }
	  --this.size;
	  return true;
	}

	/**
	 * Gets the list cache value for `key`.
	 *
	 * @private
	 * @name get
	 * @memberOf ListCache
	 * @param {string} key The key of the value to get.
	 * @returns {*} Returns the entry value.
	 */
	function listCacheGet(key) {
	  var data = this.__data__,
	      index = assocIndexOf(data, key);

	  return index < 0 ? undefined : data[index][1];
	}

	/**
	 * Checks if a list cache value for `key` exists.
	 *
	 * @private
	 * @name has
	 * @memberOf ListCache
	 * @param {string} key The key of the entry to check.
	 * @returns {boolean} Returns `true` if an entry for `key` exists, else `false`.
	 */
	function listCacheHas(key) {
	  return assocIndexOf(this.__data__, key) > -1;
	}

	/**
	 * Sets the list cache `key` to `value`.
	 *
	 * @private
	 * @name set
	 * @memberOf ListCache
	 * @param {string} key The key of the value to set.
	 * @param {*} value The value to set.
	 * @returns {Object} Returns the list cache instance.
	 */
	function listCacheSet(key, value) {
	  var data = this.__data__,
	      index = assocIndexOf(data, key);

	  if (index < 0) {
	    ++this.size;
	    data.push([key, value]);
	  } else {
	    data[index][1] = value;
	  }
	  return this;
	}

	// Add methods to `ListCache`.
	ListCache.prototype.clear = listCacheClear;
	ListCache.prototype['delete'] = listCacheDelete;
	ListCache.prototype.get = listCacheGet;
	ListCache.prototype.has = listCacheHas;
	ListCache.prototype.set = listCacheSet;

	/**
	 * Creates a map cache object to store key-value pairs.
	 *
	 * @private
	 * @constructor
	 * @param {Array} [entries] The key-value pairs to cache.
	 */
	function MapCache(entries) {
	  var index = -1,
	      length = entries == null ? 0 : entries.length;

	  this.clear();
	  while (++index < length) {
	    var entry = entries[index];
	    this.set(entry[0], entry[1]);
	  }
	}

	/**
	 * Removes all key-value entries from the map.
	 *
	 * @private
	 * @name clear
	 * @memberOf MapCache
	 */
	function mapCacheClear() {
	  this.size = 0;
	  this.__data__ = {
	    'hash': new Hash,
	    'map': new (Map || ListCache),
	    'string': new Hash
	  };
	}

	/**
	 * Removes `key` and its value from the map.
	 *
	 * @private
	 * @name delete
	 * @memberOf MapCache
	 * @param {string} key The key of the value to remove.
	 * @returns {boolean} Returns `true` if the entry was removed, else `false`.
	 */
	function mapCacheDelete(key) {
	  var result = getMapData(this, key)['delete'](key);
	  this.size -= result ? 1 : 0;
	  return result;
	}

	/**
	 * Gets the map value for `key`.
	 *
	 * @private
	 * @name get
	 * @memberOf MapCache
	 * @param {string} key The key of the value to get.
	 * @returns {*} Returns the entry value.
	 */
	function mapCacheGet(key) {
	  return getMapData(this, key).get(key);
	}

	/**
	 * Checks if a map value for `key` exists.
	 *
	 * @private
	 * @name has
	 * @memberOf MapCache
	 * @param {string} key The key of the entry to check.
	 * @returns {boolean} Returns `true` if an entry for `key` exists, else `false`.
	 */
	function mapCacheHas(key) {
	  return getMapData(this, key).has(key);
	}

	/**
	 * Sets the map `key` to `value`.
	 *
	 * @private
	 * @name set
	 * @memberOf MapCache
	 * @param {string} key The key of the value to set.
	 * @param {*} value The value to set.
	 * @returns {Object} Returns the map cache instance.
	 */
	function mapCacheSet(key, value) {
	  var data = getMapData(this, key),
	      size = data.size;

	  data.set(key, value);
	  this.size += data.size == size ? 0 : 1;
	  return this;
	}

	// Add methods to `MapCache`.
	MapCache.prototype.clear = mapCacheClear;
	MapCache.prototype['delete'] = mapCacheDelete;
	MapCache.prototype.get = mapCacheGet;
	MapCache.prototype.has = mapCacheHas;
	MapCache.prototype.set = mapCacheSet;

	/**
	 *
	 * Creates an array cache object to store unique values.
	 *
	 * @private
	 * @constructor
	 * @param {Array} [values] The values to cache.
	 */
	function SetCache(values) {
	  var index = -1,
	      length = values == null ? 0 : values.length;

	  this.__data__ = new MapCache;
	  while (++index < length) {
	    this.add(values[index]);
	  }
	}

	/**
	 * Adds `value` to the array cache.
	 *
	 * @private
	 * @name add
	 * @memberOf SetCache
	 * @alias push
	 * @param {*} value The value to cache.
	 * @returns {Object} Returns the cache instance.
	 */
	function setCacheAdd(value) {
	  this.__data__.set(value, HASH_UNDEFINED);
	  return this;
	}

	/**
	 * Checks if `value` is in the array cache.
	 *
	 * @private
	 * @name has
	 * @memberOf SetCache
	 * @param {*} value The value to search for.
	 * @returns {number} Returns `true` if `value` is found, else `false`.
	 */
	function setCacheHas(value) {
	  return this.__data__.has(value);
	}

	// Add methods to `SetCache`.
	SetCache.prototype.add = SetCache.prototype.push = setCacheAdd;
	SetCache.prototype.has = setCacheHas;

	/**
	 * Creates a stack cache object to store key-value pairs.
	 *
	 * @private
	 * @constructor
	 * @param {Array} [entries] The key-value pairs to cache.
	 */
	function Stack(entries) {
	  var data = this.__data__ = new ListCache(entries);
	  this.size = data.size;
	}

	/**
	 * Removes all key-value entries from the stack.
	 *
	 * @private
	 * @name clear
	 * @memberOf Stack
	 */
	function stackClear() {
	  this.__data__ = new ListCache;
	  this.size = 0;
	}

	/**
	 * Removes `key` and its value from the stack.
	 *
	 * @private
	 * @name delete
	 * @memberOf Stack
	 * @param {string} key The key of the value to remove.
	 * @returns {boolean} Returns `true` if the entry was removed, else `false`.
	 */
	function stackDelete(key) {
	  var data = this.__data__,
	      result = data['delete'](key);

	  this.size = data.size;
	  return result;
	}

	/**
	 * Gets the stack value for `key`.
	 *
	 * @private
	 * @name get
	 * @memberOf Stack
	 * @param {string} key The key of the value to get.
	 * @returns {*} Returns the entry value.
	 */
	function stackGet(key) {
	  return this.__data__.get(key);
	}

	/**
	 * Checks if a stack value for `key` exists.
	 *
	 * @private
	 * @name has
	 * @memberOf Stack
	 * @param {string} key The key of the entry to check.
	 * @returns {boolean} Returns `true` if an entry for `key` exists, else `false`.
	 */
	function stackHas(key) {
	  return this.__data__.has(key);
	}

	/**
	 * Sets the stack `key` to `value`.
	 *
	 * @private
	 * @name set
	 * @memberOf Stack
	 * @param {string} key The key of the value to set.
	 * @param {*} value The value to set.
	 * @returns {Object} Returns the stack cache instance.
	 */
	function stackSet(key, value) {
	  var data = this.__data__;
	  if (data instanceof ListCache) {
	    var pairs = data.__data__;
	    if (!Map || (pairs.length < LARGE_ARRAY_SIZE - 1)) {
	      pairs.push([key, value]);
	      this.size = ++data.size;
	      return this;
	    }
	    data = this.__data__ = new MapCache(pairs);
	  }
	  data.set(key, value);
	  this.size = data.size;
	  return this;
	}

	// Add methods to `Stack`.
	Stack.prototype.clear = stackClear;
	Stack.prototype['delete'] = stackDelete;
	Stack.prototype.get = stackGet;
	Stack.prototype.has = stackHas;
	Stack.prototype.set = stackSet;

	/**
	 * Creates an array of the enumerable property names of the array-like `value`.
	 *
	 * @private
	 * @param {*} value The value to query.
	 * @param {boolean} inherited Specify returning inherited property names.
	 * @returns {Array} Returns the array of property names.
	 */
	function arrayLikeKeys(value, inherited) {
	  var isArr = isArray(value),
	      isArg = !isArr && isArguments(value),
	      isBuff = !isArr && !isArg && isBuffer(value),
	      isType = !isArr && !isArg && !isBuff && isTypedArray(value),
	      skipIndexes = isArr || isArg || isBuff || isType,
	      result = skipIndexes ? baseTimes(value.length, String) : [],
	      length = result.length;

	  for (var key in value) {
	    if ((inherited || hasOwnProperty.call(value, key)) &&
	        !(skipIndexes && (
	           // Safari 9 has enumerable `arguments.length` in strict mode.
	           key == 'length' ||
	           // Node.js 0.10 has enumerable non-index properties on buffers.
	           (isBuff && (key == 'offset' || key == 'parent')) ||
	           // PhantomJS 2 has enumerable non-index properties on typed arrays.
	           (isType && (key == 'buffer' || key == 'byteLength' || key == 'byteOffset')) ||
	           // Skip index properties.
	           isIndex(key, length)
	        ))) {
	      result.push(key);
	    }
	  }
	  return result;
	}

	/**
	 * Gets the index at which the `key` is found in `array` of key-value pairs.
	 *
	 * @private
	 * @param {Array} array The array to inspect.
	 * @param {*} key The key to search for.
	 * @returns {number} Returns the index of the matched value, else `-1`.
	 */
	function assocIndexOf(array, key) {
	  var length = array.length;
	  while (length--) {
	    if (eq(array[length][0], key)) {
	      return length;
	    }
	  }
	  return -1;
	}

	/**
	 * The base implementation of `getAllKeys` and `getAllKeysIn` which uses
	 * `keysFunc` and `symbolsFunc` to get the enumerable property names and
	 * symbols of `object`.
	 *
	 * @private
	 * @param {Object} object The object to query.
	 * @param {Function} keysFunc The function to get the keys of `object`.
	 * @param {Function} symbolsFunc The function to get the symbols of `object`.
	 * @returns {Array} Returns the array of property names and symbols.
	 */
	function baseGetAllKeys(object, keysFunc, symbolsFunc) {
	  var result = keysFunc(object);
	  return isArray(object) ? result : arrayPush(result, symbolsFunc(object));
	}

	/**
	 * The base implementation of `getTag` without fallbacks for buggy environments.
	 *
	 * @private
	 * @param {*} value The value to query.
	 * @returns {string} Returns the `toStringTag`.
	 */
	function baseGetTag(value) {
	  if (value == null) {
	    return value === undefined ? undefinedTag : nullTag;
	  }
	  return (symToStringTag && symToStringTag in Object(value))
	    ? getRawTag(value)
	    : objectToString(value);
	}

	/**
	 * The base implementation of `_.isArguments`.
	 *
	 * @private
	 * @param {*} value The value to check.
	 * @returns {boolean} Returns `true` if `value` is an `arguments` object,
	 */
	function baseIsArguments(value) {
	  return isObjectLike(value) && baseGetTag(value) == argsTag;
	}

	/**
	 * The base implementation of `_.isEqual` which supports partial comparisons
	 * and tracks traversed objects.
	 *
	 * @private
	 * @param {*} value The value to compare.
	 * @param {*} other The other value to compare.
	 * @param {boolean} bitmask The bitmask flags.
	 *  1 - Unordered comparison
	 *  2 - Partial comparison
	 * @param {Function} [customizer] The function to customize comparisons.
	 * @param {Object} [stack] Tracks traversed `value` and `other` objects.
	 * @returns {boolean} Returns `true` if the values are equivalent, else `false`.
	 */
	function baseIsEqual(value, other, bitmask, customizer, stack) {
	  if (value === other) {
	    return true;
	  }
	  if (value == null || other == null || (!isObjectLike(value) && !isObjectLike(other))) {
	    return value !== value && other !== other;
	  }
	  return baseIsEqualDeep(value, other, bitmask, customizer, baseIsEqual, stack);
	}

	/**
	 * A specialized version of `baseIsEqual` for arrays and objects which performs
	 * deep comparisons and tracks traversed objects enabling objects with circular
	 * references to be compared.
	 *
	 * @private
	 * @param {Object} object The object to compare.
	 * @param {Object} other The other object to compare.
	 * @param {number} bitmask The bitmask flags. See `baseIsEqual` for more details.
	 * @param {Function} customizer The function to customize comparisons.
	 * @param {Function} equalFunc The function to determine equivalents of values.
	 * @param {Object} [stack] Tracks traversed `object` and `other` objects.
	 * @returns {boolean} Returns `true` if the objects are equivalent, else `false`.
	 */
	function baseIsEqualDeep(object, other, bitmask, customizer, equalFunc, stack) {
	  var objIsArr = isArray(object),
	      othIsArr = isArray(other),
	      objTag = objIsArr ? arrayTag : getTag(object),
	      othTag = othIsArr ? arrayTag : getTag(other);

	  objTag = objTag == argsTag ? objectTag : objTag;
	  othTag = othTag == argsTag ? objectTag : othTag;

	  var objIsObj = objTag == objectTag,
	      othIsObj = othTag == objectTag,
	      isSameTag = objTag == othTag;

	  if (isSameTag && isBuffer(object)) {
	    if (!isBuffer(other)) {
	      return false;
	    }
	    objIsArr = true;
	    objIsObj = false;
	  }
	  if (isSameTag && !objIsObj) {
	    stack || (stack = new Stack);
	    return (objIsArr || isTypedArray(object))
	      ? equalArrays(object, other, bitmask, customizer, equalFunc, stack)
	      : equalByTag(object, other, objTag, bitmask, customizer, equalFunc, stack);
	  }
	  if (!(bitmask & COMPARE_PARTIAL_FLAG)) {
	    var objIsWrapped = objIsObj && hasOwnProperty.call(object, '__wrapped__'),
	        othIsWrapped = othIsObj && hasOwnProperty.call(other, '__wrapped__');

	    if (objIsWrapped || othIsWrapped) {
	      var objUnwrapped = objIsWrapped ? object.value() : object,
	          othUnwrapped = othIsWrapped ? other.value() : other;

	      stack || (stack = new Stack);
	      return equalFunc(objUnwrapped, othUnwrapped, bitmask, customizer, stack);
	    }
	  }
	  if (!isSameTag) {
	    return false;
	  }
	  stack || (stack = new Stack);
	  return equalObjects(object, other, bitmask, customizer, equalFunc, stack);
	}

	/**
	 * The base implementation of `_.isNative` without bad shim checks.
	 *
	 * @private
	 * @param {*} value The value to check.
	 * @returns {boolean} Returns `true` if `value` is a native function,
	 *  else `false`.
	 */
	function baseIsNative(value) {
	  if (!isObject(value) || isMasked(value)) {
	    return false;
	  }
	  var pattern = isFunction(value) ? reIsNative : reIsHostCtor;
	  return pattern.test(toSource(value));
	}

	/**
	 * The base implementation of `_.isTypedArray` without Node.js optimizations.
	 *
	 * @private
	 * @param {*} value The value to check.
	 * @returns {boolean} Returns `true` if `value` is a typed array, else `false`.
	 */
	function baseIsTypedArray(value) {
	  return isObjectLike(value) &&
	    isLength(value.length) && !!typedArrayTags[baseGetTag(value)];
	}

	/**
	 * The base implementation of `_.keys` which doesn't treat sparse arrays as dense.
	 *
	 * @private
	 * @param {Object} object The object to query.
	 * @returns {Array} Returns the array of property names.
	 */
	function baseKeys(object) {
	  if (!isPrototype(object)) {
	    return nativeKeys(object);
	  }
	  var result = [];
	  for (var key in Object(object)) {
	    if (hasOwnProperty.call(object, key) && key != 'constructor') {
	      result.push(key);
	    }
	  }
	  return result;
	}

	/**
	 * A specialized version of `baseIsEqualDeep` for arrays with support for
	 * partial deep comparisons.
	 *
	 * @private
	 * @param {Array} array The array to compare.
	 * @param {Array} other The other array to compare.
	 * @param {number} bitmask The bitmask flags. See `baseIsEqual` for more details.
	 * @param {Function} customizer The function to customize comparisons.
	 * @param {Function} equalFunc The function to determine equivalents of values.
	 * @param {Object} stack Tracks traversed `array` and `other` objects.
	 * @returns {boolean} Returns `true` if the arrays are equivalent, else `false`.
	 */
	function equalArrays(array, other, bitmask, customizer, equalFunc, stack) {
	  var isPartial = bitmask & COMPARE_PARTIAL_FLAG,
	      arrLength = array.length,
	      othLength = other.length;

	  if (arrLength != othLength && !(isPartial && othLength > arrLength)) {
	    return false;
	  }
	  // Assume cyclic values are equal.
	  var stacked = stack.get(array);
	  if (stacked && stack.get(other)) {
	    return stacked == other;
	  }
	  var index = -1,
	      result = true,
	      seen = (bitmask & COMPARE_UNORDERED_FLAG) ? new SetCache : undefined;

	  stack.set(array, other);
	  stack.set(other, array);

	  // Ignore non-index properties.
	  while (++index < arrLength) {
	    var arrValue = array[index],
	        othValue = other[index];

	    if (customizer) {
	      var compared = isPartial
	        ? customizer(othValue, arrValue, index, other, array, stack)
	        : customizer(arrValue, othValue, index, array, other, stack);
	    }
	    if (compared !== undefined) {
	      if (compared) {
	        continue;
	      }
	      result = false;
	      break;
	    }
	    // Recursively compare arrays (susceptible to call stack limits).
	    if (seen) {
	      if (!arraySome(other, function(othValue, othIndex) {
	            if (!cacheHas(seen, othIndex) &&
	                (arrValue === othValue || equalFunc(arrValue, othValue, bitmask, customizer, stack))) {
	              return seen.push(othIndex);
	            }
	          })) {
	        result = false;
	        break;
	      }
	    } else if (!(
	          arrValue === othValue ||
	            equalFunc(arrValue, othValue, bitmask, customizer, stack)
	        )) {
	      result = false;
	      break;
	    }
	  }
	  stack['delete'](array);
	  stack['delete'](other);
	  return result;
	}

	/**
	 * A specialized version of `baseIsEqualDeep` for comparing objects of
	 * the same `toStringTag`.
	 *
	 * **Note:** This function only supports comparing values with tags of
	 * `Boolean`, `Date`, `Error`, `Number`, `RegExp`, or `String`.
	 *
	 * @private
	 * @param {Object} object The object to compare.
	 * @param {Object} other The other object to compare.
	 * @param {string} tag The `toStringTag` of the objects to compare.
	 * @param {number} bitmask The bitmask flags. See `baseIsEqual` for more details.
	 * @param {Function} customizer The function to customize comparisons.
	 * @param {Function} equalFunc The function to determine equivalents of values.
	 * @param {Object} stack Tracks traversed `object` and `other` objects.
	 * @returns {boolean} Returns `true` if the objects are equivalent, else `false`.
	 */
	function equalByTag(object, other, tag, bitmask, customizer, equalFunc, stack) {
	  switch (tag) {
	    case dataViewTag:
	      if ((object.byteLength != other.byteLength) ||
	          (object.byteOffset != other.byteOffset)) {
	        return false;
	      }
	      object = object.buffer;
	      other = other.buffer;

	    case arrayBufferTag:
	      if ((object.byteLength != other.byteLength) ||
	          !equalFunc(new Uint8Array(object), new Uint8Array(other))) {
	        return false;
	      }
	      return true;

	    case boolTag:
	    case dateTag:
	    case numberTag:
	      // Coerce booleans to `1` or `0` and dates to milliseconds.
	      // Invalid dates are coerced to `NaN`.
	      return eq(+object, +other);

	    case errorTag:
	      return object.name == other.name && object.message == other.message;

	    case regexpTag:
	    case stringTag:
	      // Coerce regexes to strings and treat strings, primitives and objects,
	      // as equal. See http://www.ecma-international.org/ecma-262/7.0/#sec-regexp.prototype.tostring
	      // for more details.
	      return object == (other + '');

	    case mapTag:
	      var convert = mapToArray;

	    case setTag:
	      var isPartial = bitmask & COMPARE_PARTIAL_FLAG;
	      convert || (convert = setToArray);

	      if (object.size != other.size && !isPartial) {
	        return false;
	      }
	      // Assume cyclic values are equal.
	      var stacked = stack.get(object);
	      if (stacked) {
	        return stacked == other;
	      }
	      bitmask |= COMPARE_UNORDERED_FLAG;

	      // Recursively compare objects (susceptible to call stack limits).
	      stack.set(object, other);
	      var result = equalArrays(convert(object), convert(other), bitmask, customizer, equalFunc, stack);
	      stack['delete'](object);
	      return result;

	    case symbolTag:
	      if (symbolValueOf) {
	        return symbolValueOf.call(object) == symbolValueOf.call(other);
	      }
	  }
	  return false;
	}

	/**
	 * A specialized version of `baseIsEqualDeep` for objects with support for
	 * partial deep comparisons.
	 *
	 * @private
	 * @param {Object} object The object to compare.
	 * @param {Object} other The other object to compare.
	 * @param {number} bitmask The bitmask flags. See `baseIsEqual` for more details.
	 * @param {Function} customizer The function to customize comparisons.
	 * @param {Function} equalFunc The function to determine equivalents of values.
	 * @param {Object} stack Tracks traversed `object` and `other` objects.
	 * @returns {boolean} Returns `true` if the objects are equivalent, else `false`.
	 */
	function equalObjects(object, other, bitmask, customizer, equalFunc, stack) {
	  var isPartial = bitmask & COMPARE_PARTIAL_FLAG,
	      objProps = getAllKeys(object),
	      objLength = objProps.length,
	      othProps = getAllKeys(other),
	      othLength = othProps.length;

	  if (objLength != othLength && !isPartial) {
	    return false;
	  }
	  var index = objLength;
	  while (index--) {
	    var key = objProps[index];
	    if (!(isPartial ? key in other : hasOwnProperty.call(other, key))) {
	      return false;
	    }
	  }
	  // Assume cyclic values are equal.
	  var stacked = stack.get(object);
	  if (stacked && stack.get(other)) {
	    return stacked == other;
	  }
	  var result = true;
	  stack.set(object, other);
	  stack.set(other, object);

	  var skipCtor = isPartial;
	  while (++index < objLength) {
	    key = objProps[index];
	    var objValue = object[key],
	        othValue = other[key];

	    if (customizer) {
	      var compared = isPartial
	        ? customizer(othValue, objValue, key, other, object, stack)
	        : customizer(objValue, othValue, key, object, other, stack);
	    }
	    // Recursively compare objects (susceptible to call stack limits).
	    if (!(compared === undefined
	          ? (objValue === othValue || equalFunc(objValue, othValue, bitmask, customizer, stack))
	          : compared
	        )) {
	      result = false;
	      break;
	    }
	    skipCtor || (skipCtor = key == 'constructor');
	  }
	  if (result && !skipCtor) {
	    var objCtor = object.constructor,
	        othCtor = other.constructor;

	    // Non `Object` object instances with different constructors are not equal.
	    if (objCtor != othCtor &&
	        ('constructor' in object && 'constructor' in other) &&
	        !(typeof objCtor == 'function' && objCtor instanceof objCtor &&
	          typeof othCtor == 'function' && othCtor instanceof othCtor)) {
	      result = false;
	    }
	  }
	  stack['delete'](object);
	  stack['delete'](other);
	  return result;
	}

	/**
	 * Creates an array of own enumerable property names and symbols of `object`.
	 *
	 * @private
	 * @param {Object} object The object to query.
	 * @returns {Array} Returns the array of property names and symbols.
	 */
	function getAllKeys(object) {
	  return baseGetAllKeys(object, keys, getSymbols);
	}

	/**
	 * Gets the data for `map`.
	 *
	 * @private
	 * @param {Object} map The map to query.
	 * @param {string} key The reference key.
	 * @returns {*} Returns the map data.
	 */
	function getMapData(map, key) {
	  var data = map.__data__;
	  return isKeyable(key)
	    ? data[typeof key == 'string' ? 'string' : 'hash']
	    : data.map;
	}

	/**
	 * Gets the native function at `key` of `object`.
	 *
	 * @private
	 * @param {Object} object The object to query.
	 * @param {string} key The key of the method to get.
	 * @returns {*} Returns the function if it's native, else `undefined`.
	 */
	function getNative(object, key) {
	  var value = getValue(object, key);
	  return baseIsNative(value) ? value : undefined;
	}

	/**
	 * A specialized version of `baseGetTag` which ignores `Symbol.toStringTag` values.
	 *
	 * @private
	 * @param {*} value The value to query.
	 * @returns {string} Returns the raw `toStringTag`.
	 */
	function getRawTag(value) {
	  var isOwn = hasOwnProperty.call(value, symToStringTag),
	      tag = value[symToStringTag];

	  try {
	    value[symToStringTag] = undefined;
	    var unmasked = true;
	  } catch (e) {}

	  var result = nativeObjectToString.call(value);
	  if (unmasked) {
	    if (isOwn) {
	      value[symToStringTag] = tag;
	    } else {
	      delete value[symToStringTag];
	    }
	  }
	  return result;
	}

	/**
	 * Creates an array of the own enumerable symbols of `object`.
	 *
	 * @private
	 * @param {Object} object The object to query.
	 * @returns {Array} Returns the array of symbols.
	 */
	var getSymbols = !nativeGetSymbols ? stubArray : function(object) {
	  if (object == null) {
	    return [];
	  }
	  object = Object(object);
	  return arrayFilter(nativeGetSymbols(object), function(symbol) {
	    return propertyIsEnumerable.call(object, symbol);
	  });
	};

	/**
	 * Gets the `toStringTag` of `value`.
	 *
	 * @private
	 * @param {*} value The value to query.
	 * @returns {string} Returns the `toStringTag`.
	 */
	var getTag = baseGetTag;

	// Fallback for data views, maps, sets, and weak maps in IE 11 and promises in Node.js < 6.
	if ((DataView && getTag(new DataView(new ArrayBuffer(1))) != dataViewTag) ||
	    (Map && getTag(new Map) != mapTag) ||
	    (Promise && getTag(Promise.resolve()) != promiseTag) ||
	    (Set && getTag(new Set) != setTag) ||
	    (WeakMap && getTag(new WeakMap) != weakMapTag)) {
	  getTag = function(value) {
	    var result = baseGetTag(value),
	        Ctor = result == objectTag ? value.constructor : undefined,
	        ctorString = Ctor ? toSource(Ctor) : '';

	    if (ctorString) {
	      switch (ctorString) {
	        case dataViewCtorString: return dataViewTag;
	        case mapCtorString: return mapTag;
	        case promiseCtorString: return promiseTag;
	        case setCtorString: return setTag;
	        case weakMapCtorString: return weakMapTag;
	      }
	    }
	    return result;
	  };
	}

	/**
	 * Checks if `value` is a valid array-like index.
	 *
	 * @private
	 * @param {*} value The value to check.
	 * @param {number} [length=MAX_SAFE_INTEGER] The upper bounds of a valid index.
	 * @returns {boolean} Returns `true` if `value` is a valid index, else `false`.
	 */
	function isIndex(value, length) {
	  length = length == null ? MAX_SAFE_INTEGER : length;
	  return !!length &&
	    (typeof value == 'number' || reIsUint.test(value)) &&
	    (value > -1 && value % 1 == 0 && value < length);
	}

	/**
	 * Checks if `value` is suitable for use as unique object key.
	 *
	 * @private
	 * @param {*} value The value to check.
	 * @returns {boolean} Returns `true` if `value` is suitable, else `false`.
	 */
	function isKeyable(value) {
	  var type = typeof value;
	  return (type == 'string' || type == 'number' || type == 'symbol' || type == 'boolean')
	    ? (value !== '__proto__')
	    : (value === null);
	}

	/**
	 * Checks if `func` has its source masked.
	 *
	 * @private
	 * @param {Function} func The function to check.
	 * @returns {boolean} Returns `true` if `func` is masked, else `false`.
	 */
	function isMasked(func) {
	  return !!maskSrcKey && (maskSrcKey in func);
	}

	/**
	 * Checks if `value` is likely a prototype object.
	 *
	 * @private
	 * @param {*} value The value to check.
	 * @returns {boolean} Returns `true` if `value` is a prototype, else `false`.
	 */
	function isPrototype(value) {
	  var Ctor = value && value.constructor,
	      proto = (typeof Ctor == 'function' && Ctor.prototype) || objectProto;

	  return value === proto;
	}

	/**
	 * Converts `value` to a string using `Object.prototype.toString`.
	 *
	 * @private
	 * @param {*} value The value to convert.
	 * @returns {string} Returns the converted string.
	 */
	function objectToString(value) {
	  return nativeObjectToString.call(value);
	}

	/**
	 * Converts `func` to its source code.
	 *
	 * @private
	 * @param {Function} func The function to convert.
	 * @returns {string} Returns the source code.
	 */
	function toSource(func) {
	  if (func != null) {
	    try {
	      return funcToString.call(func);
	    } catch (e) {}
	    try {
	      return (func + '');
	    } catch (e) {}
	  }
	  return '';
	}

	/**
	 * Performs a
	 * [`SameValueZero`](http://ecma-international.org/ecma-262/7.0/#sec-samevaluezero)
	 * comparison between two values to determine if they are equivalent.
	 *
	 * @static
	 * @memberOf _
	 * @since 4.0.0
	 * @category Lang
	 * @param {*} value The value to compare.
	 * @param {*} other The other value to compare.
	 * @returns {boolean} Returns `true` if the values are equivalent, else `false`.
	 * @example
	 *
	 * var object = { 'a': 1 };
	 * var other = { 'a': 1 };
	 *
	 * _.eq(object, object);
	 * // => true
	 *
	 * _.eq(object, other);
	 * // => false
	 *
	 * _.eq('a', 'a');
	 * // => true
	 *
	 * _.eq('a', Object('a'));
	 * // => false
	 *
	 * _.eq(NaN, NaN);
	 * // => true
	 */
	function eq(value, other) {
	  return value === other || (value !== value && other !== other);
	}

	/**
	 * Checks if `value` is likely an `arguments` object.
	 *
	 * @static
	 * @memberOf _
	 * @since 0.1.0
	 * @category Lang
	 * @param {*} value The value to check.
	 * @returns {boolean} Returns `true` if `value` is an `arguments` object,
	 *  else `false`.
	 * @example
	 *
	 * _.isArguments(function() { return arguments; }());
	 * // => true
	 *
	 * _.isArguments([1, 2, 3]);
	 * // => false
	 */
	var isArguments = baseIsArguments(function() { return arguments; }()) ? baseIsArguments : function(value) {
	  return isObjectLike(value) && hasOwnProperty.call(value, 'callee') &&
	    !propertyIsEnumerable.call(value, 'callee');
	};

	/**
	 * Checks if `value` is classified as an `Array` object.
	 *
	 * @static
	 * @memberOf _
	 * @since 0.1.0
	 * @category Lang
	 * @param {*} value The value to check.
	 * @returns {boolean} Returns `true` if `value` is an array, else `false`.
	 * @example
	 *
	 * _.isArray([1, 2, 3]);
	 * // => true
	 *
	 * _.isArray(document.body.children);
	 * // => false
	 *
	 * _.isArray('abc');
	 * // => false
	 *
	 * _.isArray(_.noop);
	 * // => false
	 */
	var isArray = Array.isArray;

	/**
	 * Checks if `value` is array-like. A value is considered array-like if it's
	 * not a function and has a `value.length` that's an integer greater than or
	 * equal to `0` and less than or equal to `Number.MAX_SAFE_INTEGER`.
	 *
	 * @static
	 * @memberOf _
	 * @since 4.0.0
	 * @category Lang
	 * @param {*} value The value to check.
	 * @returns {boolean} Returns `true` if `value` is array-like, else `false`.
	 * @example
	 *
	 * _.isArrayLike([1, 2, 3]);
	 * // => true
	 *
	 * _.isArrayLike(document.body.children);
	 * // => true
	 *
	 * _.isArrayLike('abc');
	 * // => true
	 *
	 * _.isArrayLike(_.noop);
	 * // => false
	 */
	function isArrayLike(value) {
	  return value != null && isLength(value.length) && !isFunction(value);
	}

	/**
	 * Checks if `value` is a buffer.
	 *
	 * @static
	 * @memberOf _
	 * @since 4.3.0
	 * @category Lang
	 * @param {*} value The value to check.
	 * @returns {boolean} Returns `true` if `value` is a buffer, else `false`.
	 * @example
	 *
	 * _.isBuffer(new Buffer(2));
	 * // => true
	 *
	 * _.isBuffer(new Uint8Array(2));
	 * // => false
	 */
	var isBuffer = nativeIsBuffer || stubFalse;

	/**
	 * Performs a deep comparison between two values to determine if they are
	 * equivalent.
	 *
	 * **Note:** This method supports comparing arrays, array buffers, booleans,
	 * date objects, error objects, maps, numbers, `Object` objects, regexes,
	 * sets, strings, symbols, and typed arrays. `Object` objects are compared
	 * by their own, not inherited, enumerable properties. Functions and DOM
	 * nodes are compared by strict equality, i.e. `===`.
	 *
	 * @static
	 * @memberOf _
	 * @since 0.1.0
	 * @category Lang
	 * @param {*} value The value to compare.
	 * @param {*} other The other value to compare.
	 * @returns {boolean} Returns `true` if the values are equivalent, else `false`.
	 * @example
	 *
	 * var object = { 'a': 1 };
	 * var other = { 'a': 1 };
	 *
	 * _.isEqual(object, other);
	 * // => true
	 *
	 * object === other;
	 * // => false
	 */
	function isEqual(value, other) {
	  return baseIsEqual(value, other);
	}

	/**
	 * Checks if `value` is classified as a `Function` object.
	 *
	 * @static
	 * @memberOf _
	 * @since 0.1.0
	 * @category Lang
	 * @param {*} value The value to check.
	 * @returns {boolean} Returns `true` if `value` is a function, else `false`.
	 * @example
	 *
	 * _.isFunction(_);
	 * // => true
	 *
	 * _.isFunction(/abc/);
	 * // => false
	 */
	function isFunction(value) {
	  if (!isObject(value)) {
	    return false;
	  }
	  // The use of `Object#toString` avoids issues with the `typeof` operator
	  // in Safari 9 which returns 'object' for typed arrays and other constructors.
	  var tag = baseGetTag(value);
	  return tag == funcTag || tag == genTag || tag == asyncTag || tag == proxyTag;
	}

	/**
	 * Checks if `value` is a valid array-like length.
	 *
	 * **Note:** This method is loosely based on
	 * [`ToLength`](http://ecma-international.org/ecma-262/7.0/#sec-tolength).
	 *
	 * @static
	 * @memberOf _
	 * @since 4.0.0
	 * @category Lang
	 * @param {*} value The value to check.
	 * @returns {boolean} Returns `true` if `value` is a valid length, else `false`.
	 * @example
	 *
	 * _.isLength(3);
	 * // => true
	 *
	 * _.isLength(Number.MIN_VALUE);
	 * // => false
	 *
	 * _.isLength(Infinity);
	 * // => false
	 *
	 * _.isLength('3');
	 * // => false
	 */
	function isLength(value) {
	  return typeof value == 'number' &&
	    value > -1 && value % 1 == 0 && value <= MAX_SAFE_INTEGER;
	}

	/**
	 * Checks if `value` is the
	 * [language type](http://www.ecma-international.org/ecma-262/7.0/#sec-ecmascript-language-types)
	 * of `Object`. (e.g. arrays, functions, objects, regexes, `new Number(0)`, and `new String('')`)
	 *
	 * @static
	 * @memberOf _
	 * @since 0.1.0
	 * @category Lang
	 * @param {*} value The value to check.
	 * @returns {boolean} Returns `true` if `value` is an object, else `false`.
	 * @example
	 *
	 * _.isObject({});
	 * // => true
	 *
	 * _.isObject([1, 2, 3]);
	 * // => true
	 *
	 * _.isObject(_.noop);
	 * // => true
	 *
	 * _.isObject(null);
	 * // => false
	 */
	function isObject(value) {
	  var type = typeof value;
	  return value != null && (type == 'object' || type == 'function');
	}

	/**
	 * Checks if `value` is object-like. A value is object-like if it's not `null`
	 * and has a `typeof` result of "object".
	 *
	 * @static
	 * @memberOf _
	 * @since 4.0.0
	 * @category Lang
	 * @param {*} value The value to check.
	 * @returns {boolean} Returns `true` if `value` is object-like, else `false`.
	 * @example
	 *
	 * _.isObjectLike({});
	 * // => true
	 *
	 * _.isObjectLike([1, 2, 3]);
	 * // => true
	 *
	 * _.isObjectLike(_.noop);
	 * // => false
	 *
	 * _.isObjectLike(null);
	 * // => false
	 */
	function isObjectLike(value) {
	  return value != null && typeof value == 'object';
	}

	/**
	 * Checks if `value` is classified as a typed array.
	 *
	 * @static
	 * @memberOf _
	 * @since 3.0.0
	 * @category Lang
	 * @param {*} value The value to check.
	 * @returns {boolean} Returns `true` if `value` is a typed array, else `false`.
	 * @example
	 *
	 * _.isTypedArray(new Uint8Array);
	 * // => true
	 *
	 * _.isTypedArray([]);
	 * // => false
	 */
	var isTypedArray = nodeIsTypedArray ? baseUnary(nodeIsTypedArray) : baseIsTypedArray;

	/**
	 * Creates an array of the own enumerable property names of `object`.
	 *
	 * **Note:** Non-object values are coerced to objects. See the
	 * [ES spec](http://ecma-international.org/ecma-262/7.0/#sec-object.keys)
	 * for more details.
	 *
	 * @static
	 * @since 0.1.0
	 * @memberOf _
	 * @category Object
	 * @param {Object} object The object to query.
	 * @returns {Array} Returns the array of property names.
	 * @example
	 *
	 * function Foo() {
	 *   this.a = 1;
	 *   this.b = 2;
	 * }
	 *
	 * Foo.prototype.c = 3;
	 *
	 * _.keys(new Foo);
	 * // => ['a', 'b'] (iteration order is not guaranteed)
	 *
	 * _.keys('hi');
	 * // => ['0', '1']
	 */
	function keys(object) {
	  return isArrayLike(object) ? arrayLikeKeys(object) : baseKeys(object);
	}

	/**
	 * This method returns a new empty array.
	 *
	 * @static
	 * @memberOf _
	 * @since 4.13.0
	 * @category Util
	 * @returns {Array} Returns the new empty array.
	 * @example
	 *
	 * var arrays = _.times(2, _.stubArray);
	 *
	 * console.log(arrays);
	 * // => [[], []]
	 *
	 * console.log(arrays[0] === arrays[1]);
	 * // => false
	 */
	function stubArray() {
	  return [];
	}

	/**
	 * This method returns `false`.
	 *
	 * @static
	 * @memberOf _
	 * @since 4.13.0
	 * @category Util
	 * @returns {boolean} Returns `false`.
	 * @example
	 *
	 * _.times(2, _.stubFalse);
	 * // => [false, false]
	 */
	function stubFalse() {
	  return false;
	}

	module.exports = isEqual;
	});

	var __importDefault$3 = (commonjsGlobal && commonjsGlobal.__importDefault) || function (mod) {
	    return (mod && mod.__esModule) ? mod : { "default": mod };
	};

	var lodash_clonedeep_1$1 = __importDefault$3(lodash_clonedeep);
	var lodash_isequal_1$1 = __importDefault$3(lodash_isequal);
	var AttributeMap;
	(function (AttributeMap) {
	    function compose(a, b, keepNull) {
	        if (a === void 0) { a = {}; }
	        if (b === void 0) { b = {}; }
	        if (typeof a !== 'object') {
	            a = {};
	        }
	        if (typeof b !== 'object') {
	            b = {};
	        }
	        var attributes = lodash_clonedeep_1$1.default(b);
	        if (!keepNull) {
	            attributes = Object.keys(attributes).reduce(function (copy, key) {
	                if (attributes[key] != null) {
	                    copy[key] = attributes[key];
	                }
	                return copy;
	            }, {});
	        }
	        for (var key in a) {
	            if (a[key] !== undefined && b[key] === undefined) {
	                attributes[key] = a[key];
	            }
	        }
	        return Object.keys(attributes).length > 0 ? attributes : undefined;
	    }
	    AttributeMap.compose = compose;
	    function diff(a, b) {
	        if (a === void 0) { a = {}; }
	        if (b === void 0) { b = {}; }
	        if (typeof a !== 'object') {
	            a = {};
	        }
	        if (typeof b !== 'object') {
	            b = {};
	        }
	        var attributes = Object.keys(a)
	            .concat(Object.keys(b))
	            .reduce(function (attrs, key) {
	            if (!lodash_isequal_1$1.default(a[key], b[key])) {
	                attrs[key] = b[key] === undefined ? null : b[key];
	            }
	            return attrs;
	        }, {});
	        return Object.keys(attributes).length > 0 ? attributes : undefined;
	    }
	    AttributeMap.diff = diff;
	    function invert(attr, base) {
	        if (attr === void 0) { attr = {}; }
	        if (base === void 0) { base = {}; }
	        attr = attr || {};
	        var baseInverted = Object.keys(base).reduce(function (memo, key) {
	            if (base[key] !== attr[key] && attr[key] !== undefined) {
	                memo[key] = base[key];
	            }
	            return memo;
	        }, {});
	        return Object.keys(attr).reduce(function (memo, key) {
	            if (attr[key] !== base[key] && base[key] === undefined) {
	                memo[key] = null;
	            }
	            return memo;
	        }, baseInverted);
	    }
	    AttributeMap.invert = invert;
	    function transform(a, b, priority) {
	        if (priority === void 0) { priority = false; }
	        if (typeof a !== 'object') {
	            return b;
	        }
	        if (typeof b !== 'object') {
	            return undefined;
	        }
	        if (!priority) {
	            return b; // b simply overwrites us without priority
	        }
	        var attributes = Object.keys(b).reduce(function (attrs, key) {
	            if (a[key] === undefined) {
	                attrs[key] = b[key]; // null is a valid value
	            }
	            return attrs;
	        }, {});
	        return Object.keys(attributes).length > 0 ? attributes : undefined;
	    }
	    AttributeMap.transform = transform;
	})(AttributeMap || (AttributeMap = {}));
	var _default$2 = AttributeMap;


	var AttributeMap_1$1 = /*#__PURE__*/Object.defineProperty({
		default: _default$2
	}, '__esModule', {value: true});

	var require$$4 = Op_1$1;

	var __importDefault$2 = (commonjsGlobal && commonjsGlobal.__importDefault) || function (mod) {
	    return (mod && mod.__esModule) ? mod : { "default": mod };
	};

	var Op_1$2 = __importDefault$2(require$$4);
	var Iterator = /** @class */ (function () {
	    function Iterator(ops) {
	        this.ops = ops;
	        this.index = 0;
	        this.offset = 0;
	    }
	    Iterator.prototype.hasNext = function () {
	        return this.peekLength() < Infinity;
	    };
	    Iterator.prototype.next = function (length) {
	        if (!length) {
	            length = Infinity;
	        }
	        var nextOp = this.ops[this.index];
	        if (nextOp) {
	            var offset = this.offset;
	            var opLength = Op_1$2.default.length(nextOp);
	            if (length >= opLength - offset) {
	                length = opLength - offset;
	                this.index += 1;
	                this.offset = 0;
	            }
	            else {
	                this.offset += length;
	            }
	            if (typeof nextOp.delete === 'number') {
	                return { delete: length };
	            }
	            else {
	                var retOp = {};
	                if (nextOp.attributes) {
	                    retOp.attributes = nextOp.attributes;
	                }
	                if (typeof nextOp.retain === 'number') {
	                    retOp.retain = length;
	                }
	                else if (typeof nextOp.insert === 'string') {
	                    retOp.insert = nextOp.insert.substr(offset, length);
	                }
	                else {
	                    // offset should === 0, length should === 1
	                    retOp.insert = nextOp.insert;
	                }
	                return retOp;
	            }
	        }
	        else {
	            return { retain: Infinity };
	        }
	    };
	    Iterator.prototype.peek = function () {
	        return this.ops[this.index];
	    };
	    Iterator.prototype.peekLength = function () {
	        if (this.ops[this.index]) {
	            // Should never return 0 if our index is being managed correctly
	            return Op_1$2.default.length(this.ops[this.index]) - this.offset;
	        }
	        else {
	            return Infinity;
	        }
	    };
	    Iterator.prototype.peekType = function () {
	        if (this.ops[this.index]) {
	            if (typeof this.ops[this.index].delete === 'number') {
	                return 'delete';
	            }
	            else if (typeof this.ops[this.index].retain === 'number') {
	                return 'retain';
	            }
	            else {
	                return 'insert';
	            }
	        }
	        return 'retain';
	    };
	    Iterator.prototype.rest = function () {
	        if (!this.hasNext()) {
	            return [];
	        }
	        else if (this.offset === 0) {
	            return this.ops.slice(this.index);
	        }
	        else {
	            var offset = this.offset;
	            var index = this.index;
	            var next = this.next();
	            var rest = this.ops.slice(this.index);
	            this.offset = offset;
	            this.index = index;
	            return [next].concat(rest);
	        }
	    };
	    return Iterator;
	}());
	var _default$1 = Iterator;


	var Iterator_1$1 = /*#__PURE__*/Object.defineProperty({
		default: _default$1
	}, '__esModule', {value: true});

	var __importDefault$1 = (commonjsGlobal && commonjsGlobal.__importDefault) || function (mod) {
	    return (mod && mod.__esModule) ? mod : { "default": mod };
	};

	var Iterator_1 = __importDefault$1(Iterator_1$1);
	var Op;
	(function (Op) {
	    function iterator(ops) {
	        return new Iterator_1.default(ops);
	    }
	    Op.iterator = iterator;
	    function length(op) {
	        if (typeof op.delete === 'number') {
	            return op.delete;
	        }
	        else if (typeof op.retain === 'number') {
	            return op.retain;
	        }
	        else {
	            return typeof op.insert === 'string' ? op.insert.length : 1;
	        }
	    }
	    Op.length = length;
	})(Op || (Op = {}));
	var _default = Op;


	var Op_1$1 = /*#__PURE__*/Object.defineProperty({
		default: _default
	}, '__esModule', {value: true});

	var __importDefault = (commonjsGlobal && commonjsGlobal.__importDefault) || function (mod) {
	    return (mod && mod.__esModule) ? mod : { "default": mod };
	};
	var fast_diff_1 = __importDefault(diff_1);
	var lodash_clonedeep_1 = __importDefault(lodash_clonedeep);
	var lodash_isequal_1 = __importDefault(lodash_isequal);
	var AttributeMap_1 = __importDefault(AttributeMap_1$1);
	var Op_1 = __importDefault(require$$4);
	var NULL_CHARACTER = String.fromCharCode(0); // Placeholder char for embed in diff()
	var Delta = /** @class */ (function () {
	    function Delta(ops) {
	        // Assume we are given a well formed ops
	        if (Array.isArray(ops)) {
	            this.ops = ops;
	        }
	        else if (ops != null && Array.isArray(ops.ops)) {
	            this.ops = ops.ops;
	        }
	        else {
	            this.ops = [];
	        }
	    }
	    Delta.prototype.insert = function (arg, attributes) {
	        var newOp = {};
	        if (typeof arg === 'string' && arg.length === 0) {
	            return this;
	        }
	        newOp.insert = arg;
	        if (attributes != null &&
	            typeof attributes === 'object' &&
	            Object.keys(attributes).length > 0) {
	            newOp.attributes = attributes;
	        }
	        return this.push(newOp);
	    };
	    Delta.prototype.delete = function (length) {
	        if (length <= 0) {
	            return this;
	        }
	        return this.push({ delete: length });
	    };
	    Delta.prototype.retain = function (length, attributes) {
	        if (length <= 0) {
	            return this;
	        }
	        var newOp = { retain: length };
	        if (attributes != null &&
	            typeof attributes === 'object' &&
	            Object.keys(attributes).length > 0) {
	            newOp.attributes = attributes;
	        }
	        return this.push(newOp);
	    };
	    Delta.prototype.push = function (newOp) {
	        var index = this.ops.length;
	        var lastOp = this.ops[index - 1];
	        newOp = lodash_clonedeep_1.default(newOp);
	        if (typeof lastOp === 'object') {
	            if (typeof newOp.delete === 'number' &&
	                typeof lastOp.delete === 'number') {
	                this.ops[index - 1] = { delete: lastOp.delete + newOp.delete };
	                return this;
	            }
	            // Since it does not matter if we insert before or after deleting at the same index,
	            // always prefer to insert first
	            if (typeof lastOp.delete === 'number' && newOp.insert != null) {
	                index -= 1;
	                lastOp = this.ops[index - 1];
	                if (typeof lastOp !== 'object') {
	                    this.ops.unshift(newOp);
	                    return this;
	                }
	            }
	            if (lodash_isequal_1.default(newOp.attributes, lastOp.attributes)) {
	                if (typeof newOp.insert === 'string' &&
	                    typeof lastOp.insert === 'string') {
	                    this.ops[index - 1] = { insert: lastOp.insert + newOp.insert };
	                    if (typeof newOp.attributes === 'object') {
	                        this.ops[index - 1].attributes = newOp.attributes;
	                    }
	                    return this;
	                }
	                else if (typeof newOp.retain === 'number' &&
	                    typeof lastOp.retain === 'number') {
	                    this.ops[index - 1] = { retain: lastOp.retain + newOp.retain };
	                    if (typeof newOp.attributes === 'object') {
	                        this.ops[index - 1].attributes = newOp.attributes;
	                    }
	                    return this;
	                }
	            }
	        }
	        if (index === this.ops.length) {
	            this.ops.push(newOp);
	        }
	        else {
	            this.ops.splice(index, 0, newOp);
	        }
	        return this;
	    };
	    Delta.prototype.chop = function () {
	        var lastOp = this.ops[this.ops.length - 1];
	        if (lastOp && lastOp.retain && !lastOp.attributes) {
	            this.ops.pop();
	        }
	        return this;
	    };
	    Delta.prototype.filter = function (predicate) {
	        return this.ops.filter(predicate);
	    };
	    Delta.prototype.forEach = function (predicate) {
	        this.ops.forEach(predicate);
	    };
	    Delta.prototype.map = function (predicate) {
	        return this.ops.map(predicate);
	    };
	    Delta.prototype.partition = function (predicate) {
	        var passed = [];
	        var failed = [];
	        this.forEach(function (op) {
	            var target = predicate(op) ? passed : failed;
	            target.push(op);
	        });
	        return [passed, failed];
	    };
	    Delta.prototype.reduce = function (predicate, initialValue) {
	        return this.ops.reduce(predicate, initialValue);
	    };
	    Delta.prototype.changeLength = function () {
	        return this.reduce(function (length, elem) {
	            if (elem.insert) {
	                return length + Op_1.default.length(elem);
	            }
	            else if (elem.delete) {
	                return length - elem.delete;
	            }
	            return length;
	        }, 0);
	    };
	    Delta.prototype.length = function () {
	        return this.reduce(function (length, elem) {
	            return length + Op_1.default.length(elem);
	        }, 0);
	    };
	    Delta.prototype.slice = function (start, end) {
	        if (start === void 0) { start = 0; }
	        if (end === void 0) { end = Infinity; }
	        var ops = [];
	        var iter = Op_1.default.iterator(this.ops);
	        var index = 0;
	        while (index < end && iter.hasNext()) {
	            var nextOp = void 0;
	            if (index < start) {
	                nextOp = iter.next(start - index);
	            }
	            else {
	                nextOp = iter.next(end - index);
	                ops.push(nextOp);
	            }
	            index += Op_1.default.length(nextOp);
	        }
	        return new Delta(ops);
	    };
	    Delta.prototype.compose = function (other) {
	        var thisIter = Op_1.default.iterator(this.ops);
	        var otherIter = Op_1.default.iterator(other.ops);
	        var ops = [];
	        var firstOther = otherIter.peek();
	        if (firstOther != null &&
	            typeof firstOther.retain === 'number' &&
	            firstOther.attributes == null) {
	            var firstLeft = firstOther.retain;
	            while (thisIter.peekType() === 'insert' &&
	                thisIter.peekLength() <= firstLeft) {
	                firstLeft -= thisIter.peekLength();
	                ops.push(thisIter.next());
	            }
	            if (firstOther.retain - firstLeft > 0) {
	                otherIter.next(firstOther.retain - firstLeft);
	            }
	        }
	        var delta = new Delta(ops);
	        while (thisIter.hasNext() || otherIter.hasNext()) {
	            if (otherIter.peekType() === 'insert') {
	                delta.push(otherIter.next());
	            }
	            else if (thisIter.peekType() === 'delete') {
	                delta.push(thisIter.next());
	            }
	            else {
	                var length_1 = Math.min(thisIter.peekLength(), otherIter.peekLength());
	                var thisOp = thisIter.next(length_1);
	                var otherOp = otherIter.next(length_1);
	                if (typeof otherOp.retain === 'number') {
	                    var newOp = {};
	                    if (typeof thisOp.retain === 'number') {
	                        newOp.retain = length_1;
	                    }
	                    else {
	                        newOp.insert = thisOp.insert;
	                    }
	                    // Preserve null when composing with a retain, otherwise remove it for inserts
	                    var attributes = AttributeMap_1.default.compose(thisOp.attributes, otherOp.attributes, typeof thisOp.retain === 'number');
	                    if (attributes) {
	                        newOp.attributes = attributes;
	                    }
	                    delta.push(newOp);
	                    // Optimization if rest of other is just retain
	                    if (!otherIter.hasNext() &&
	                        lodash_isequal_1.default(delta.ops[delta.ops.length - 1], newOp)) {
	                        var rest = new Delta(thisIter.rest());
	                        return delta.concat(rest).chop();
	                    }
	                    // Other op should be delete, we could be an insert or retain
	                    // Insert + delete cancels out
	                }
	                else if (typeof otherOp.delete === 'number' &&
	                    typeof thisOp.retain === 'number') {
	                    delta.push(otherOp);
	                }
	            }
	        }
	        return delta.chop();
	    };
	    Delta.prototype.concat = function (other) {
	        var delta = new Delta(this.ops.slice());
	        if (other.ops.length > 0) {
	            delta.push(other.ops[0]);
	            delta.ops = delta.ops.concat(other.ops.slice(1));
	        }
	        return delta;
	    };
	    Delta.prototype.diff = function (other, cursor) {
	        if (this.ops === other.ops) {
	            return new Delta();
	        }
	        var strings = [this, other].map(function (delta) {
	            return delta
	                .map(function (op) {
	                if (op.insert != null) {
	                    return typeof op.insert === 'string' ? op.insert : NULL_CHARACTER;
	                }
	                var prep = delta === other ? 'on' : 'with';
	                throw new Error('diff() called ' + prep + ' non-document');
	            })
	                .join('');
	        });
	        var retDelta = new Delta();
	        var diffResult = fast_diff_1.default(strings[0], strings[1], cursor);
	        var thisIter = Op_1.default.iterator(this.ops);
	        var otherIter = Op_1.default.iterator(other.ops);
	        diffResult.forEach(function (component) {
	            var length = component[1].length;
	            while (length > 0) {
	                var opLength = 0;
	                switch (component[0]) {
	                    case fast_diff_1.default.INSERT:
	                        opLength = Math.min(otherIter.peekLength(), length);
	                        retDelta.push(otherIter.next(opLength));
	                        break;
	                    case fast_diff_1.default.DELETE:
	                        opLength = Math.min(length, thisIter.peekLength());
	                        thisIter.next(opLength);
	                        retDelta.delete(opLength);
	                        break;
	                    case fast_diff_1.default.EQUAL:
	                        opLength = Math.min(thisIter.peekLength(), otherIter.peekLength(), length);
	                        var thisOp = thisIter.next(opLength);
	                        var otherOp = otherIter.next(opLength);
	                        if (lodash_isequal_1.default(thisOp.insert, otherOp.insert)) {
	                            retDelta.retain(opLength, AttributeMap_1.default.diff(thisOp.attributes, otherOp.attributes));
	                        }
	                        else {
	                            retDelta.push(otherOp).delete(opLength);
	                        }
	                        break;
	                }
	                length -= opLength;
	            }
	        });
	        return retDelta.chop();
	    };
	    Delta.prototype.eachLine = function (predicate, newline) {
	        if (newline === void 0) { newline = '\n'; }
	        var iter = Op_1.default.iterator(this.ops);
	        var line = new Delta();
	        var i = 0;
	        while (iter.hasNext()) {
	            if (iter.peekType() !== 'insert') {
	                return;
	            }
	            var thisOp = iter.peek();
	            var start = Op_1.default.length(thisOp) - iter.peekLength();
	            var index = typeof thisOp.insert === 'string'
	                ? thisOp.insert.indexOf(newline, start) - start
	                : -1;
	            if (index < 0) {
	                line.push(iter.next());
	            }
	            else if (index > 0) {
	                line.push(iter.next(index));
	            }
	            else {
	                if (predicate(line, iter.next(1).attributes || {}, i) === false) {
	                    return;
	                }
	                i += 1;
	                line = new Delta();
	            }
	        }
	        if (line.length() > 0) {
	            predicate(line, {}, i);
	        }
	    };
	    Delta.prototype.invert = function (base) {
	        var inverted = new Delta();
	        this.reduce(function (baseIndex, op) {
	            if (op.insert) {
	                inverted.delete(Op_1.default.length(op));
	            }
	            else if (op.retain && op.attributes == null) {
	                inverted.retain(op.retain);
	                return baseIndex + op.retain;
	            }
	            else if (op.delete || (op.retain && op.attributes)) {
	                var length_2 = (op.delete || op.retain);
	                var slice = base.slice(baseIndex, baseIndex + length_2);
	                slice.forEach(function (baseOp) {
	                    if (op.delete) {
	                        inverted.push(baseOp);
	                    }
	                    else if (op.retain && op.attributes) {
	                        inverted.retain(Op_1.default.length(baseOp), AttributeMap_1.default.invert(op.attributes, baseOp.attributes));
	                    }
	                });
	                return baseIndex + length_2;
	            }
	            return baseIndex;
	        }, 0);
	        return inverted.chop();
	    };
	    Delta.prototype.transform = function (arg, priority) {
	        if (priority === void 0) { priority = false; }
	        priority = !!priority;
	        if (typeof arg === 'number') {
	            return this.transformPosition(arg, priority);
	        }
	        var other = arg;
	        var thisIter = Op_1.default.iterator(this.ops);
	        var otherIter = Op_1.default.iterator(other.ops);
	        var delta = new Delta();
	        while (thisIter.hasNext() || otherIter.hasNext()) {
	            if (thisIter.peekType() === 'insert' &&
	                (priority || otherIter.peekType() !== 'insert')) {
	                delta.retain(Op_1.default.length(thisIter.next()));
	            }
	            else if (otherIter.peekType() === 'insert') {
	                delta.push(otherIter.next());
	            }
	            else {
	                var length_3 = Math.min(thisIter.peekLength(), otherIter.peekLength());
	                var thisOp = thisIter.next(length_3);
	                var otherOp = otherIter.next(length_3);
	                if (thisOp.delete) {
	                    // Our delete either makes their delete redundant or removes their retain
	                    continue;
	                }
	                else if (otherOp.delete) {
	                    delta.push(otherOp);
	                }
	                else {
	                    // We retain either their retain or insert
	                    delta.retain(length_3, AttributeMap_1.default.transform(thisOp.attributes, otherOp.attributes, priority));
	                }
	            }
	        }
	        return delta.chop();
	    };
	    Delta.prototype.transformPosition = function (index, priority) {
	        if (priority === void 0) { priority = false; }
	        priority = !!priority;
	        var thisIter = Op_1.default.iterator(this.ops);
	        var offset = 0;
	        while (thisIter.hasNext() && offset <= index) {
	            var length_4 = thisIter.peekLength();
	            var nextType = thisIter.peekType();
	            thisIter.next();
	            if (nextType === 'delete') {
	                index -= Math.min(length_4, index - offset);
	                continue;
	            }
	            else if (nextType === 'insert' && (offset < index || !priority)) {
	                index += length_4;
	            }
	            offset += length_4;
	        }
	        return index;
	    };
	    Delta.Op = Op_1.default;
	    Delta.AttributeMap = AttributeMap_1.default;
	    return Delta;
	}());
	var Delta_1 = Delta;

	return Delta_1;

}));
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicXVpbGwtZGVsdGEuanMiLCJzb3VyY2VzIjpbIi4uL25vZGVfbW9kdWxlcy9mYXN0LWRpZmYvZGlmZi5qcyIsIi4uL25vZGVfbW9kdWxlcy9sb2Rhc2guY2xvbmVkZWVwL2luZGV4LmpzIiwiLi4vbm9kZV9tb2R1bGVzL2xvZGFzaC5pc2VxdWFsL2luZGV4LmpzIiwiLi4vbm9kZV9tb2R1bGVzL3F1aWxsLWRlbHRhL2Rpc3QvQXR0cmlidXRlTWFwLmpzIiwiLi4vbm9kZV9tb2R1bGVzL3F1aWxsLWRlbHRhL2Rpc3QvSXRlcmF0b3IuanMiLCIuLi9ub2RlX21vZHVsZXMvcXVpbGwtZGVsdGEvZGlzdC9PcC5qcyIsIi4uL25vZGVfbW9kdWxlcy9xdWlsbC1kZWx0YS9kaXN0L0RlbHRhLmpzIl0sInNvdXJjZXNDb250ZW50IjpbIi8qKlxuICogVGhpcyBsaWJyYXJ5IG1vZGlmaWVzIHRoZSBkaWZmLXBhdGNoLW1hdGNoIGxpYnJhcnkgYnkgTmVpbCBGcmFzZXJcbiAqIGJ5IHJlbW92aW5nIHRoZSBwYXRjaCBhbmQgbWF0Y2ggZnVuY3Rpb25hbGl0eSBhbmQgY2VydGFpbiBhZHZhbmNlZFxuICogb3B0aW9ucyBpbiB0aGUgZGlmZiBmdW5jdGlvbi4gVGhlIG9yaWdpbmFsIGxpY2Vuc2UgaXMgYXMgZm9sbG93czpcbiAqXG4gKiA9PT1cbiAqXG4gKiBEaWZmIE1hdGNoIGFuZCBQYXRjaFxuICpcbiAqIENvcHlyaWdodCAyMDA2IEdvb2dsZSBJbmMuXG4gKiBodHRwOi8vY29kZS5nb29nbGUuY29tL3AvZ29vZ2xlLWRpZmYtbWF0Y2gtcGF0Y2gvXG4gKlxuICogTGljZW5zZWQgdW5kZXIgdGhlIEFwYWNoZSBMaWNlbnNlLCBWZXJzaW9uIDIuMCAodGhlIFwiTGljZW5zZVwiKTtcbiAqIHlvdSBtYXkgbm90IHVzZSB0aGlzIGZpbGUgZXhjZXB0IGluIGNvbXBsaWFuY2Ugd2l0aCB0aGUgTGljZW5zZS5cbiAqIFlvdSBtYXkgb2J0YWluIGEgY29weSBvZiB0aGUgTGljZW5zZSBhdFxuICpcbiAqICAgaHR0cDovL3d3dy5hcGFjaGUub3JnL2xpY2Vuc2VzL0xJQ0VOU0UtMi4wXG4gKlxuICogVW5sZXNzIHJlcXVpcmVkIGJ5IGFwcGxpY2FibGUgbGF3IG9yIGFncmVlZCB0byBpbiB3cml0aW5nLCBzb2Z0d2FyZVxuICogZGlzdHJpYnV0ZWQgdW5kZXIgdGhlIExpY2Vuc2UgaXMgZGlzdHJpYnV0ZWQgb24gYW4gXCJBUyBJU1wiIEJBU0lTLFxuICogV0lUSE9VVCBXQVJSQU5USUVTIE9SIENPTkRJVElPTlMgT0YgQU5ZIEtJTkQsIGVpdGhlciBleHByZXNzIG9yIGltcGxpZWQuXG4gKiBTZWUgdGhlIExpY2Vuc2UgZm9yIHRoZSBzcGVjaWZpYyBsYW5ndWFnZSBnb3Zlcm5pbmcgcGVybWlzc2lvbnMgYW5kXG4gKiBsaW1pdGF0aW9ucyB1bmRlciB0aGUgTGljZW5zZS5cbiAqL1xuXG5cbi8qKlxuICogVGhlIGRhdGEgc3RydWN0dXJlIHJlcHJlc2VudGluZyBhIGRpZmYgaXMgYW4gYXJyYXkgb2YgdHVwbGVzOlxuICogW1tESUZGX0RFTEVURSwgJ0hlbGxvJ10sIFtESUZGX0lOU0VSVCwgJ0dvb2RieWUnXSwgW0RJRkZfRVFVQUwsICcgd29ybGQuJ11dXG4gKiB3aGljaCBtZWFuczogZGVsZXRlICdIZWxsbycsIGFkZCAnR29vZGJ5ZScgYW5kIGtlZXAgJyB3b3JsZC4nXG4gKi9cbnZhciBESUZGX0RFTEVURSA9IC0xO1xudmFyIERJRkZfSU5TRVJUID0gMTtcbnZhciBESUZGX0VRVUFMID0gMDtcblxuXG4vKipcbiAqIEZpbmQgdGhlIGRpZmZlcmVuY2VzIGJldHdlZW4gdHdvIHRleHRzLiAgU2ltcGxpZmllcyB0aGUgcHJvYmxlbSBieSBzdHJpcHBpbmdcbiAqIGFueSBjb21tb24gcHJlZml4IG9yIHN1ZmZpeCBvZmYgdGhlIHRleHRzIGJlZm9yZSBkaWZmaW5nLlxuICogQHBhcmFtIHtzdHJpbmd9IHRleHQxIE9sZCBzdHJpbmcgdG8gYmUgZGlmZmVkLlxuICogQHBhcmFtIHtzdHJpbmd9IHRleHQyIE5ldyBzdHJpbmcgdG8gYmUgZGlmZmVkLlxuICogQHBhcmFtIHtJbnR8T2JqZWN0fSBbY3Vyc29yX3Bvc10gRWRpdCBwb3NpdGlvbiBpbiB0ZXh0MSBvciBvYmplY3Qgd2l0aCBtb3JlIGluZm9cbiAqIEByZXR1cm4ge0FycmF5fSBBcnJheSBvZiBkaWZmIHR1cGxlcy5cbiAqL1xuZnVuY3Rpb24gZGlmZl9tYWluKHRleHQxLCB0ZXh0MiwgY3Vyc29yX3BvcywgX2ZpeF91bmljb2RlKSB7XG4gIC8vIENoZWNrIGZvciBlcXVhbGl0eVxuICBpZiAodGV4dDEgPT09IHRleHQyKSB7XG4gICAgaWYgKHRleHQxKSB7XG4gICAgICByZXR1cm4gW1tESUZGX0VRVUFMLCB0ZXh0MV1dO1xuICAgIH1cbiAgICByZXR1cm4gW107XG4gIH1cblxuICBpZiAoY3Vyc29yX3BvcyAhPSBudWxsKSB7XG4gICAgdmFyIGVkaXRkaWZmID0gZmluZF9jdXJzb3JfZWRpdF9kaWZmKHRleHQxLCB0ZXh0MiwgY3Vyc29yX3Bvcyk7XG4gICAgaWYgKGVkaXRkaWZmKSB7XG4gICAgICByZXR1cm4gZWRpdGRpZmY7XG4gICAgfVxuICB9XG5cbiAgLy8gVHJpbSBvZmYgY29tbW9uIHByZWZpeCAoc3BlZWR1cCkuXG4gIHZhciBjb21tb25sZW5ndGggPSBkaWZmX2NvbW1vblByZWZpeCh0ZXh0MSwgdGV4dDIpO1xuICB2YXIgY29tbW9ucHJlZml4ID0gdGV4dDEuc3Vic3RyaW5nKDAsIGNvbW1vbmxlbmd0aCk7XG4gIHRleHQxID0gdGV4dDEuc3Vic3RyaW5nKGNvbW1vbmxlbmd0aCk7XG4gIHRleHQyID0gdGV4dDIuc3Vic3RyaW5nKGNvbW1vbmxlbmd0aCk7XG5cbiAgLy8gVHJpbSBvZmYgY29tbW9uIHN1ZmZpeCAoc3BlZWR1cCkuXG4gIGNvbW1vbmxlbmd0aCA9IGRpZmZfY29tbW9uU3VmZml4KHRleHQxLCB0ZXh0Mik7XG4gIHZhciBjb21tb25zdWZmaXggPSB0ZXh0MS5zdWJzdHJpbmcodGV4dDEubGVuZ3RoIC0gY29tbW9ubGVuZ3RoKTtcbiAgdGV4dDEgPSB0ZXh0MS5zdWJzdHJpbmcoMCwgdGV4dDEubGVuZ3RoIC0gY29tbW9ubGVuZ3RoKTtcbiAgdGV4dDIgPSB0ZXh0Mi5zdWJzdHJpbmcoMCwgdGV4dDIubGVuZ3RoIC0gY29tbW9ubGVuZ3RoKTtcblxuICAvLyBDb21wdXRlIHRoZSBkaWZmIG9uIHRoZSBtaWRkbGUgYmxvY2suXG4gIHZhciBkaWZmcyA9IGRpZmZfY29tcHV0ZV8odGV4dDEsIHRleHQyKTtcblxuICAvLyBSZXN0b3JlIHRoZSBwcmVmaXggYW5kIHN1ZmZpeC5cbiAgaWYgKGNvbW1vbnByZWZpeCkge1xuICAgIGRpZmZzLnVuc2hpZnQoW0RJRkZfRVFVQUwsIGNvbW1vbnByZWZpeF0pO1xuICB9XG4gIGlmIChjb21tb25zdWZmaXgpIHtcbiAgICBkaWZmcy5wdXNoKFtESUZGX0VRVUFMLCBjb21tb25zdWZmaXhdKTtcbiAgfVxuICBkaWZmX2NsZWFudXBNZXJnZShkaWZmcywgX2ZpeF91bmljb2RlKTtcbiAgcmV0dXJuIGRpZmZzO1xufTtcblxuXG4vKipcbiAqIEZpbmQgdGhlIGRpZmZlcmVuY2VzIGJldHdlZW4gdHdvIHRleHRzLiAgQXNzdW1lcyB0aGF0IHRoZSB0ZXh0cyBkbyBub3RcbiAqIGhhdmUgYW55IGNvbW1vbiBwcmVmaXggb3Igc3VmZml4LlxuICogQHBhcmFtIHtzdHJpbmd9IHRleHQxIE9sZCBzdHJpbmcgdG8gYmUgZGlmZmVkLlxuICogQHBhcmFtIHtzdHJpbmd9IHRleHQyIE5ldyBzdHJpbmcgdG8gYmUgZGlmZmVkLlxuICogQHJldHVybiB7QXJyYXl9IEFycmF5IG9mIGRpZmYgdHVwbGVzLlxuICovXG5mdW5jdGlvbiBkaWZmX2NvbXB1dGVfKHRleHQxLCB0ZXh0Mikge1xuICB2YXIgZGlmZnM7XG5cbiAgaWYgKCF0ZXh0MSkge1xuICAgIC8vIEp1c3QgYWRkIHNvbWUgdGV4dCAoc3BlZWR1cCkuXG4gICAgcmV0dXJuIFtbRElGRl9JTlNFUlQsIHRleHQyXV07XG4gIH1cblxuICBpZiAoIXRleHQyKSB7XG4gICAgLy8gSnVzdCBkZWxldGUgc29tZSB0ZXh0IChzcGVlZHVwKS5cbiAgICByZXR1cm4gW1tESUZGX0RFTEVURSwgdGV4dDFdXTtcbiAgfVxuXG4gIHZhciBsb25ndGV4dCA9IHRleHQxLmxlbmd0aCA+IHRleHQyLmxlbmd0aCA/IHRleHQxIDogdGV4dDI7XG4gIHZhciBzaG9ydHRleHQgPSB0ZXh0MS5sZW5ndGggPiB0ZXh0Mi5sZW5ndGggPyB0ZXh0MiA6IHRleHQxO1xuICB2YXIgaSA9IGxvbmd0ZXh0LmluZGV4T2Yoc2hvcnR0ZXh0KTtcbiAgaWYgKGkgIT09IC0xKSB7XG4gICAgLy8gU2hvcnRlciB0ZXh0IGlzIGluc2lkZSB0aGUgbG9uZ2VyIHRleHQgKHNwZWVkdXApLlxuICAgIGRpZmZzID0gW1xuICAgICAgW0RJRkZfSU5TRVJULCBsb25ndGV4dC5zdWJzdHJpbmcoMCwgaSldLFxuICAgICAgW0RJRkZfRVFVQUwsIHNob3J0dGV4dF0sXG4gICAgICBbRElGRl9JTlNFUlQsIGxvbmd0ZXh0LnN1YnN0cmluZyhpICsgc2hvcnR0ZXh0Lmxlbmd0aCldXG4gICAgXTtcbiAgICAvLyBTd2FwIGluc2VydGlvbnMgZm9yIGRlbGV0aW9ucyBpZiBkaWZmIGlzIHJldmVyc2VkLlxuICAgIGlmICh0ZXh0MS5sZW5ndGggPiB0ZXh0Mi5sZW5ndGgpIHtcbiAgICAgIGRpZmZzWzBdWzBdID0gZGlmZnNbMl1bMF0gPSBESUZGX0RFTEVURTtcbiAgICB9XG4gICAgcmV0dXJuIGRpZmZzO1xuICB9XG5cbiAgaWYgKHNob3J0dGV4dC5sZW5ndGggPT09IDEpIHtcbiAgICAvLyBTaW5nbGUgY2hhcmFjdGVyIHN0cmluZy5cbiAgICAvLyBBZnRlciB0aGUgcHJldmlvdXMgc3BlZWR1cCwgdGhlIGNoYXJhY3RlciBjYW4ndCBiZSBhbiBlcXVhbGl0eS5cbiAgICByZXR1cm4gW1tESUZGX0RFTEVURSwgdGV4dDFdLCBbRElGRl9JTlNFUlQsIHRleHQyXV07XG4gIH1cblxuICAvLyBDaGVjayB0byBzZWUgaWYgdGhlIHByb2JsZW0gY2FuIGJlIHNwbGl0IGluIHR3by5cbiAgdmFyIGhtID0gZGlmZl9oYWxmTWF0Y2hfKHRleHQxLCB0ZXh0Mik7XG4gIGlmIChobSkge1xuICAgIC8vIEEgaGFsZi1tYXRjaCB3YXMgZm91bmQsIHNvcnQgb3V0IHRoZSByZXR1cm4gZGF0YS5cbiAgICB2YXIgdGV4dDFfYSA9IGhtWzBdO1xuICAgIHZhciB0ZXh0MV9iID0gaG1bMV07XG4gICAgdmFyIHRleHQyX2EgPSBobVsyXTtcbiAgICB2YXIgdGV4dDJfYiA9IGhtWzNdO1xuICAgIHZhciBtaWRfY29tbW9uID0gaG1bNF07XG4gICAgLy8gU2VuZCBib3RoIHBhaXJzIG9mZiBmb3Igc2VwYXJhdGUgcHJvY2Vzc2luZy5cbiAgICB2YXIgZGlmZnNfYSA9IGRpZmZfbWFpbih0ZXh0MV9hLCB0ZXh0Ml9hKTtcbiAgICB2YXIgZGlmZnNfYiA9IGRpZmZfbWFpbih0ZXh0MV9iLCB0ZXh0Ml9iKTtcbiAgICAvLyBNZXJnZSB0aGUgcmVzdWx0cy5cbiAgICByZXR1cm4gZGlmZnNfYS5jb25jYXQoW1tESUZGX0VRVUFMLCBtaWRfY29tbW9uXV0sIGRpZmZzX2IpO1xuICB9XG5cbiAgcmV0dXJuIGRpZmZfYmlzZWN0Xyh0ZXh0MSwgdGV4dDIpO1xufTtcblxuXG4vKipcbiAqIEZpbmQgdGhlICdtaWRkbGUgc25ha2UnIG9mIGEgZGlmZiwgc3BsaXQgdGhlIHByb2JsZW0gaW4gdHdvXG4gKiBhbmQgcmV0dXJuIHRoZSByZWN1cnNpdmVseSBjb25zdHJ1Y3RlZCBkaWZmLlxuICogU2VlIE15ZXJzIDE5ODYgcGFwZXI6IEFuIE8oTkQpIERpZmZlcmVuY2UgQWxnb3JpdGhtIGFuZCBJdHMgVmFyaWF0aW9ucy5cbiAqIEBwYXJhbSB7c3RyaW5nfSB0ZXh0MSBPbGQgc3RyaW5nIHRvIGJlIGRpZmZlZC5cbiAqIEBwYXJhbSB7c3RyaW5nfSB0ZXh0MiBOZXcgc3RyaW5nIHRvIGJlIGRpZmZlZC5cbiAqIEByZXR1cm4ge0FycmF5fSBBcnJheSBvZiBkaWZmIHR1cGxlcy5cbiAqIEBwcml2YXRlXG4gKi9cbmZ1bmN0aW9uIGRpZmZfYmlzZWN0Xyh0ZXh0MSwgdGV4dDIpIHtcbiAgLy8gQ2FjaGUgdGhlIHRleHQgbGVuZ3RocyB0byBwcmV2ZW50IG11bHRpcGxlIGNhbGxzLlxuICB2YXIgdGV4dDFfbGVuZ3RoID0gdGV4dDEubGVuZ3RoO1xuICB2YXIgdGV4dDJfbGVuZ3RoID0gdGV4dDIubGVuZ3RoO1xuICB2YXIgbWF4X2QgPSBNYXRoLmNlaWwoKHRleHQxX2xlbmd0aCArIHRleHQyX2xlbmd0aCkgLyAyKTtcbiAgdmFyIHZfb2Zmc2V0ID0gbWF4X2Q7XG4gIHZhciB2X2xlbmd0aCA9IDIgKiBtYXhfZDtcbiAgdmFyIHYxID0gbmV3IEFycmF5KHZfbGVuZ3RoKTtcbiAgdmFyIHYyID0gbmV3IEFycmF5KHZfbGVuZ3RoKTtcbiAgLy8gU2V0dGluZyBhbGwgZWxlbWVudHMgdG8gLTEgaXMgZmFzdGVyIGluIENocm9tZSAmIEZpcmVmb3ggdGhhbiBtaXhpbmdcbiAgLy8gaW50ZWdlcnMgYW5kIHVuZGVmaW5lZC5cbiAgZm9yICh2YXIgeCA9IDA7IHggPCB2X2xlbmd0aDsgeCsrKSB7XG4gICAgdjFbeF0gPSAtMTtcbiAgICB2Mlt4XSA9IC0xO1xuICB9XG4gIHYxW3Zfb2Zmc2V0ICsgMV0gPSAwO1xuICB2Mlt2X29mZnNldCArIDFdID0gMDtcbiAgdmFyIGRlbHRhID0gdGV4dDFfbGVuZ3RoIC0gdGV4dDJfbGVuZ3RoO1xuICAvLyBJZiB0aGUgdG90YWwgbnVtYmVyIG9mIGNoYXJhY3RlcnMgaXMgb2RkLCB0aGVuIHRoZSBmcm9udCBwYXRoIHdpbGwgY29sbGlkZVxuICAvLyB3aXRoIHRoZSByZXZlcnNlIHBhdGguXG4gIHZhciBmcm9udCA9IChkZWx0YSAlIDIgIT09IDApO1xuICAvLyBPZmZzZXRzIGZvciBzdGFydCBhbmQgZW5kIG9mIGsgbG9vcC5cbiAgLy8gUHJldmVudHMgbWFwcGluZyBvZiBzcGFjZSBiZXlvbmQgdGhlIGdyaWQuXG4gIHZhciBrMXN0YXJ0ID0gMDtcbiAgdmFyIGsxZW5kID0gMDtcbiAgdmFyIGsyc3RhcnQgPSAwO1xuICB2YXIgazJlbmQgPSAwO1xuICBmb3IgKHZhciBkID0gMDsgZCA8IG1heF9kOyBkKyspIHtcbiAgICAvLyBXYWxrIHRoZSBmcm9udCBwYXRoIG9uZSBzdGVwLlxuICAgIGZvciAodmFyIGsxID0gLWQgKyBrMXN0YXJ0OyBrMSA8PSBkIC0gazFlbmQ7IGsxICs9IDIpIHtcbiAgICAgIHZhciBrMV9vZmZzZXQgPSB2X29mZnNldCArIGsxO1xuICAgICAgdmFyIHgxO1xuICAgICAgaWYgKGsxID09PSAtZCB8fCAoazEgIT09IGQgJiYgdjFbazFfb2Zmc2V0IC0gMV0gPCB2MVtrMV9vZmZzZXQgKyAxXSkpIHtcbiAgICAgICAgeDEgPSB2MVtrMV9vZmZzZXQgKyAxXTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHgxID0gdjFbazFfb2Zmc2V0IC0gMV0gKyAxO1xuICAgICAgfVxuICAgICAgdmFyIHkxID0geDEgLSBrMTtcbiAgICAgIHdoaWxlIChcbiAgICAgICAgeDEgPCB0ZXh0MV9sZW5ndGggJiYgeTEgPCB0ZXh0Ml9sZW5ndGggJiZcbiAgICAgICAgdGV4dDEuY2hhckF0KHgxKSA9PT0gdGV4dDIuY2hhckF0KHkxKVxuICAgICAgKSB7XG4gICAgICAgIHgxKys7XG4gICAgICAgIHkxKys7XG4gICAgICB9XG4gICAgICB2MVtrMV9vZmZzZXRdID0geDE7XG4gICAgICBpZiAoeDEgPiB0ZXh0MV9sZW5ndGgpIHtcbiAgICAgICAgLy8gUmFuIG9mZiB0aGUgcmlnaHQgb2YgdGhlIGdyYXBoLlxuICAgICAgICBrMWVuZCArPSAyO1xuICAgICAgfSBlbHNlIGlmICh5MSA+IHRleHQyX2xlbmd0aCkge1xuICAgICAgICAvLyBSYW4gb2ZmIHRoZSBib3R0b20gb2YgdGhlIGdyYXBoLlxuICAgICAgICBrMXN0YXJ0ICs9IDI7XG4gICAgICB9IGVsc2UgaWYgKGZyb250KSB7XG4gICAgICAgIHZhciBrMl9vZmZzZXQgPSB2X29mZnNldCArIGRlbHRhIC0gazE7XG4gICAgICAgIGlmIChrMl9vZmZzZXQgPj0gMCAmJiBrMl9vZmZzZXQgPCB2X2xlbmd0aCAmJiB2MltrMl9vZmZzZXRdICE9PSAtMSkge1xuICAgICAgICAgIC8vIE1pcnJvciB4MiBvbnRvIHRvcC1sZWZ0IGNvb3JkaW5hdGUgc3lzdGVtLlxuICAgICAgICAgIHZhciB4MiA9IHRleHQxX2xlbmd0aCAtIHYyW2syX29mZnNldF07XG4gICAgICAgICAgaWYgKHgxID49IHgyKSB7XG4gICAgICAgICAgICAvLyBPdmVybGFwIGRldGVjdGVkLlxuICAgICAgICAgICAgcmV0dXJuIGRpZmZfYmlzZWN0U3BsaXRfKHRleHQxLCB0ZXh0MiwgeDEsIHkxKTtcbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG5cbiAgICAvLyBXYWxrIHRoZSByZXZlcnNlIHBhdGggb25lIHN0ZXAuXG4gICAgZm9yICh2YXIgazIgPSAtZCArIGsyc3RhcnQ7IGsyIDw9IGQgLSBrMmVuZDsgazIgKz0gMikge1xuICAgICAgdmFyIGsyX29mZnNldCA9IHZfb2Zmc2V0ICsgazI7XG4gICAgICB2YXIgeDI7XG4gICAgICBpZiAoazIgPT09IC1kIHx8IChrMiAhPT0gZCAmJiB2MltrMl9vZmZzZXQgLSAxXSA8IHYyW2syX29mZnNldCArIDFdKSkge1xuICAgICAgICB4MiA9IHYyW2syX29mZnNldCArIDFdO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgeDIgPSB2MltrMl9vZmZzZXQgLSAxXSArIDE7XG4gICAgICB9XG4gICAgICB2YXIgeTIgPSB4MiAtIGsyO1xuICAgICAgd2hpbGUgKFxuICAgICAgICB4MiA8IHRleHQxX2xlbmd0aCAmJiB5MiA8IHRleHQyX2xlbmd0aCAmJlxuICAgICAgICB0ZXh0MS5jaGFyQXQodGV4dDFfbGVuZ3RoIC0geDIgLSAxKSA9PT0gdGV4dDIuY2hhckF0KHRleHQyX2xlbmd0aCAtIHkyIC0gMSlcbiAgICAgICkge1xuICAgICAgICB4MisrO1xuICAgICAgICB5MisrO1xuICAgICAgfVxuICAgICAgdjJbazJfb2Zmc2V0XSA9IHgyO1xuICAgICAgaWYgKHgyID4gdGV4dDFfbGVuZ3RoKSB7XG4gICAgICAgIC8vIFJhbiBvZmYgdGhlIGxlZnQgb2YgdGhlIGdyYXBoLlxuICAgICAgICBrMmVuZCArPSAyO1xuICAgICAgfSBlbHNlIGlmICh5MiA+IHRleHQyX2xlbmd0aCkge1xuICAgICAgICAvLyBSYW4gb2ZmIHRoZSB0b3Agb2YgdGhlIGdyYXBoLlxuICAgICAgICBrMnN0YXJ0ICs9IDI7XG4gICAgICB9IGVsc2UgaWYgKCFmcm9udCkge1xuICAgICAgICB2YXIgazFfb2Zmc2V0ID0gdl9vZmZzZXQgKyBkZWx0YSAtIGsyO1xuICAgICAgICBpZiAoazFfb2Zmc2V0ID49IDAgJiYgazFfb2Zmc2V0IDwgdl9sZW5ndGggJiYgdjFbazFfb2Zmc2V0XSAhPT0gLTEpIHtcbiAgICAgICAgICB2YXIgeDEgPSB2MVtrMV9vZmZzZXRdO1xuICAgICAgICAgIHZhciB5MSA9IHZfb2Zmc2V0ICsgeDEgLSBrMV9vZmZzZXQ7XG4gICAgICAgICAgLy8gTWlycm9yIHgyIG9udG8gdG9wLWxlZnQgY29vcmRpbmF0ZSBzeXN0ZW0uXG4gICAgICAgICAgeDIgPSB0ZXh0MV9sZW5ndGggLSB4MjtcbiAgICAgICAgICBpZiAoeDEgPj0geDIpIHtcbiAgICAgICAgICAgIC8vIE92ZXJsYXAgZGV0ZWN0ZWQuXG4gICAgICAgICAgICByZXR1cm4gZGlmZl9iaXNlY3RTcGxpdF8odGV4dDEsIHRleHQyLCB4MSwgeTEpO1xuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgfVxuICAgIH1cbiAgfVxuICAvLyBEaWZmIHRvb2sgdG9vIGxvbmcgYW5kIGhpdCB0aGUgZGVhZGxpbmUgb3JcbiAgLy8gbnVtYmVyIG9mIGRpZmZzIGVxdWFscyBudW1iZXIgb2YgY2hhcmFjdGVycywgbm8gY29tbW9uYWxpdHkgYXQgYWxsLlxuICByZXR1cm4gW1tESUZGX0RFTEVURSwgdGV4dDFdLCBbRElGRl9JTlNFUlQsIHRleHQyXV07XG59O1xuXG5cbi8qKlxuICogR2l2ZW4gdGhlIGxvY2F0aW9uIG9mIHRoZSAnbWlkZGxlIHNuYWtlJywgc3BsaXQgdGhlIGRpZmYgaW4gdHdvIHBhcnRzXG4gKiBhbmQgcmVjdXJzZS5cbiAqIEBwYXJhbSB7c3RyaW5nfSB0ZXh0MSBPbGQgc3RyaW5nIHRvIGJlIGRpZmZlZC5cbiAqIEBwYXJhbSB7c3RyaW5nfSB0ZXh0MiBOZXcgc3RyaW5nIHRvIGJlIGRpZmZlZC5cbiAqIEBwYXJhbSB7bnVtYmVyfSB4IEluZGV4IG9mIHNwbGl0IHBvaW50IGluIHRleHQxLlxuICogQHBhcmFtIHtudW1iZXJ9IHkgSW5kZXggb2Ygc3BsaXQgcG9pbnQgaW4gdGV4dDIuXG4gKiBAcmV0dXJuIHtBcnJheX0gQXJyYXkgb2YgZGlmZiB0dXBsZXMuXG4gKi9cbmZ1bmN0aW9uIGRpZmZfYmlzZWN0U3BsaXRfKHRleHQxLCB0ZXh0MiwgeCwgeSkge1xuICB2YXIgdGV4dDFhID0gdGV4dDEuc3Vic3RyaW5nKDAsIHgpO1xuICB2YXIgdGV4dDJhID0gdGV4dDIuc3Vic3RyaW5nKDAsIHkpO1xuICB2YXIgdGV4dDFiID0gdGV4dDEuc3Vic3RyaW5nKHgpO1xuICB2YXIgdGV4dDJiID0gdGV4dDIuc3Vic3RyaW5nKHkpO1xuXG4gIC8vIENvbXB1dGUgYm90aCBkaWZmcyBzZXJpYWxseS5cbiAgdmFyIGRpZmZzID0gZGlmZl9tYWluKHRleHQxYSwgdGV4dDJhKTtcbiAgdmFyIGRpZmZzYiA9IGRpZmZfbWFpbih0ZXh0MWIsIHRleHQyYik7XG5cbiAgcmV0dXJuIGRpZmZzLmNvbmNhdChkaWZmc2IpO1xufTtcblxuXG4vKipcbiAqIERldGVybWluZSB0aGUgY29tbW9uIHByZWZpeCBvZiB0d28gc3RyaW5ncy5cbiAqIEBwYXJhbSB7c3RyaW5nfSB0ZXh0MSBGaXJzdCBzdHJpbmcuXG4gKiBAcGFyYW0ge3N0cmluZ30gdGV4dDIgU2Vjb25kIHN0cmluZy5cbiAqIEByZXR1cm4ge251bWJlcn0gVGhlIG51bWJlciBvZiBjaGFyYWN0ZXJzIGNvbW1vbiB0byB0aGUgc3RhcnQgb2YgZWFjaFxuICogICAgIHN0cmluZy5cbiAqL1xuZnVuY3Rpb24gZGlmZl9jb21tb25QcmVmaXgodGV4dDEsIHRleHQyKSB7XG4gIC8vIFF1aWNrIGNoZWNrIGZvciBjb21tb24gbnVsbCBjYXNlcy5cbiAgaWYgKCF0ZXh0MSB8fCAhdGV4dDIgfHwgdGV4dDEuY2hhckF0KDApICE9PSB0ZXh0Mi5jaGFyQXQoMCkpIHtcbiAgICByZXR1cm4gMDtcbiAgfVxuICAvLyBCaW5hcnkgc2VhcmNoLlxuICAvLyBQZXJmb3JtYW5jZSBhbmFseXNpczogaHR0cDovL25laWwuZnJhc2VyLm5hbWUvbmV3cy8yMDA3LzEwLzA5L1xuICB2YXIgcG9pbnRlcm1pbiA9IDA7XG4gIHZhciBwb2ludGVybWF4ID0gTWF0aC5taW4odGV4dDEubGVuZ3RoLCB0ZXh0Mi5sZW5ndGgpO1xuICB2YXIgcG9pbnRlcm1pZCA9IHBvaW50ZXJtYXg7XG4gIHZhciBwb2ludGVyc3RhcnQgPSAwO1xuICB3aGlsZSAocG9pbnRlcm1pbiA8IHBvaW50ZXJtaWQpIHtcbiAgICBpZiAoXG4gICAgICB0ZXh0MS5zdWJzdHJpbmcocG9pbnRlcnN0YXJ0LCBwb2ludGVybWlkKSA9PVxuICAgICAgdGV4dDIuc3Vic3RyaW5nKHBvaW50ZXJzdGFydCwgcG9pbnRlcm1pZClcbiAgICApIHtcbiAgICAgIHBvaW50ZXJtaW4gPSBwb2ludGVybWlkO1xuICAgICAgcG9pbnRlcnN0YXJ0ID0gcG9pbnRlcm1pbjtcbiAgICB9IGVsc2Uge1xuICAgICAgcG9pbnRlcm1heCA9IHBvaW50ZXJtaWQ7XG4gICAgfVxuICAgIHBvaW50ZXJtaWQgPSBNYXRoLmZsb29yKChwb2ludGVybWF4IC0gcG9pbnRlcm1pbikgLyAyICsgcG9pbnRlcm1pbik7XG4gIH1cblxuICBpZiAoaXNfc3Vycm9nYXRlX3BhaXJfc3RhcnQodGV4dDEuY2hhckNvZGVBdChwb2ludGVybWlkIC0gMSkpKSB7XG4gICAgcG9pbnRlcm1pZC0tO1xuICB9XG5cbiAgcmV0dXJuIHBvaW50ZXJtaWQ7XG59O1xuXG5cbi8qKlxuICogRGV0ZXJtaW5lIHRoZSBjb21tb24gc3VmZml4IG9mIHR3byBzdHJpbmdzLlxuICogQHBhcmFtIHtzdHJpbmd9IHRleHQxIEZpcnN0IHN0cmluZy5cbiAqIEBwYXJhbSB7c3RyaW5nfSB0ZXh0MiBTZWNvbmQgc3RyaW5nLlxuICogQHJldHVybiB7bnVtYmVyfSBUaGUgbnVtYmVyIG9mIGNoYXJhY3RlcnMgY29tbW9uIHRvIHRoZSBlbmQgb2YgZWFjaCBzdHJpbmcuXG4gKi9cbmZ1bmN0aW9uIGRpZmZfY29tbW9uU3VmZml4KHRleHQxLCB0ZXh0Mikge1xuICAvLyBRdWljayBjaGVjayBmb3IgY29tbW9uIG51bGwgY2FzZXMuXG4gIGlmICghdGV4dDEgfHwgIXRleHQyIHx8IHRleHQxLnNsaWNlKC0xKSAhPT0gdGV4dDIuc2xpY2UoLTEpKSB7XG4gICAgcmV0dXJuIDA7XG4gIH1cbiAgLy8gQmluYXJ5IHNlYXJjaC5cbiAgLy8gUGVyZm9ybWFuY2UgYW5hbHlzaXM6IGh0dHA6Ly9uZWlsLmZyYXNlci5uYW1lL25ld3MvMjAwNy8xMC8wOS9cbiAgdmFyIHBvaW50ZXJtaW4gPSAwO1xuICB2YXIgcG9pbnRlcm1heCA9IE1hdGgubWluKHRleHQxLmxlbmd0aCwgdGV4dDIubGVuZ3RoKTtcbiAgdmFyIHBvaW50ZXJtaWQgPSBwb2ludGVybWF4O1xuICB2YXIgcG9pbnRlcmVuZCA9IDA7XG4gIHdoaWxlIChwb2ludGVybWluIDwgcG9pbnRlcm1pZCkge1xuICAgIGlmIChcbiAgICAgIHRleHQxLnN1YnN0cmluZyh0ZXh0MS5sZW5ndGggLSBwb2ludGVybWlkLCB0ZXh0MS5sZW5ndGggLSBwb2ludGVyZW5kKSA9PVxuICAgICAgdGV4dDIuc3Vic3RyaW5nKHRleHQyLmxlbmd0aCAtIHBvaW50ZXJtaWQsIHRleHQyLmxlbmd0aCAtIHBvaW50ZXJlbmQpXG4gICAgKSB7XG4gICAgICBwb2ludGVybWluID0gcG9pbnRlcm1pZDtcbiAgICAgIHBvaW50ZXJlbmQgPSBwb2ludGVybWluO1xuICAgIH0gZWxzZSB7XG4gICAgICBwb2ludGVybWF4ID0gcG9pbnRlcm1pZDtcbiAgICB9XG4gICAgcG9pbnRlcm1pZCA9IE1hdGguZmxvb3IoKHBvaW50ZXJtYXggLSBwb2ludGVybWluKSAvIDIgKyBwb2ludGVybWluKTtcbiAgfVxuXG4gIGlmIChpc19zdXJyb2dhdGVfcGFpcl9lbmQodGV4dDEuY2hhckNvZGVBdCh0ZXh0MS5sZW5ndGggLSBwb2ludGVybWlkKSkpIHtcbiAgICBwb2ludGVybWlkLS07XG4gIH1cblxuICByZXR1cm4gcG9pbnRlcm1pZDtcbn07XG5cblxuLyoqXG4gKiBEbyB0aGUgdHdvIHRleHRzIHNoYXJlIGEgc3Vic3RyaW5nIHdoaWNoIGlzIGF0IGxlYXN0IGhhbGYgdGhlIGxlbmd0aCBvZiB0aGVcbiAqIGxvbmdlciB0ZXh0P1xuICogVGhpcyBzcGVlZHVwIGNhbiBwcm9kdWNlIG5vbi1taW5pbWFsIGRpZmZzLlxuICogQHBhcmFtIHtzdHJpbmd9IHRleHQxIEZpcnN0IHN0cmluZy5cbiAqIEBwYXJhbSB7c3RyaW5nfSB0ZXh0MiBTZWNvbmQgc3RyaW5nLlxuICogQHJldHVybiB7QXJyYXkuPHN0cmluZz59IEZpdmUgZWxlbWVudCBBcnJheSwgY29udGFpbmluZyB0aGUgcHJlZml4IG9mXG4gKiAgICAgdGV4dDEsIHRoZSBzdWZmaXggb2YgdGV4dDEsIHRoZSBwcmVmaXggb2YgdGV4dDIsIHRoZSBzdWZmaXggb2ZcbiAqICAgICB0ZXh0MiBhbmQgdGhlIGNvbW1vbiBtaWRkbGUuICBPciBudWxsIGlmIHRoZXJlIHdhcyBubyBtYXRjaC5cbiAqL1xuZnVuY3Rpb24gZGlmZl9oYWxmTWF0Y2hfKHRleHQxLCB0ZXh0Mikge1xuICB2YXIgbG9uZ3RleHQgPSB0ZXh0MS5sZW5ndGggPiB0ZXh0Mi5sZW5ndGggPyB0ZXh0MSA6IHRleHQyO1xuICB2YXIgc2hvcnR0ZXh0ID0gdGV4dDEubGVuZ3RoID4gdGV4dDIubGVuZ3RoID8gdGV4dDIgOiB0ZXh0MTtcbiAgaWYgKGxvbmd0ZXh0Lmxlbmd0aCA8IDQgfHwgc2hvcnR0ZXh0Lmxlbmd0aCAqIDIgPCBsb25ndGV4dC5sZW5ndGgpIHtcbiAgICByZXR1cm4gbnVsbDsgIC8vIFBvaW50bGVzcy5cbiAgfVxuXG4gIC8qKlxuICAgKiBEb2VzIGEgc3Vic3RyaW5nIG9mIHNob3J0dGV4dCBleGlzdCB3aXRoaW4gbG9uZ3RleHQgc3VjaCB0aGF0IHRoZSBzdWJzdHJpbmdcbiAgICogaXMgYXQgbGVhc3QgaGFsZiB0aGUgbGVuZ3RoIG9mIGxvbmd0ZXh0P1xuICAgKiBDbG9zdXJlLCBidXQgZG9lcyBub3QgcmVmZXJlbmNlIGFueSBleHRlcm5hbCB2YXJpYWJsZXMuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBsb25ndGV4dCBMb25nZXIgc3RyaW5nLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gc2hvcnR0ZXh0IFNob3J0ZXIgc3RyaW5nLlxuICAgKiBAcGFyYW0ge251bWJlcn0gaSBTdGFydCBpbmRleCBvZiBxdWFydGVyIGxlbmd0aCBzdWJzdHJpbmcgd2l0aGluIGxvbmd0ZXh0LlxuICAgKiBAcmV0dXJuIHtBcnJheS48c3RyaW5nPn0gRml2ZSBlbGVtZW50IEFycmF5LCBjb250YWluaW5nIHRoZSBwcmVmaXggb2ZcbiAgICogICAgIGxvbmd0ZXh0LCB0aGUgc3VmZml4IG9mIGxvbmd0ZXh0LCB0aGUgcHJlZml4IG9mIHNob3J0dGV4dCwgdGhlIHN1ZmZpeFxuICAgKiAgICAgb2Ygc2hvcnR0ZXh0IGFuZCB0aGUgY29tbW9uIG1pZGRsZS4gIE9yIG51bGwgaWYgdGhlcmUgd2FzIG5vIG1hdGNoLlxuICAgKiBAcHJpdmF0ZVxuICAgKi9cbiAgZnVuY3Rpb24gZGlmZl9oYWxmTWF0Y2hJXyhsb25ndGV4dCwgc2hvcnR0ZXh0LCBpKSB7XG4gICAgLy8gU3RhcnQgd2l0aCBhIDEvNCBsZW5ndGggc3Vic3RyaW5nIGF0IHBvc2l0aW9uIGkgYXMgYSBzZWVkLlxuICAgIHZhciBzZWVkID0gbG9uZ3RleHQuc3Vic3RyaW5nKGksIGkgKyBNYXRoLmZsb29yKGxvbmd0ZXh0Lmxlbmd0aCAvIDQpKTtcbiAgICB2YXIgaiA9IC0xO1xuICAgIHZhciBiZXN0X2NvbW1vbiA9ICcnO1xuICAgIHZhciBiZXN0X2xvbmd0ZXh0X2EsIGJlc3RfbG9uZ3RleHRfYiwgYmVzdF9zaG9ydHRleHRfYSwgYmVzdF9zaG9ydHRleHRfYjtcbiAgICB3aGlsZSAoKGogPSBzaG9ydHRleHQuaW5kZXhPZihzZWVkLCBqICsgMSkpICE9PSAtMSkge1xuICAgICAgdmFyIHByZWZpeExlbmd0aCA9IGRpZmZfY29tbW9uUHJlZml4KFxuICAgICAgICBsb25ndGV4dC5zdWJzdHJpbmcoaSksIHNob3J0dGV4dC5zdWJzdHJpbmcoaikpO1xuICAgICAgdmFyIHN1ZmZpeExlbmd0aCA9IGRpZmZfY29tbW9uU3VmZml4KFxuICAgICAgICBsb25ndGV4dC5zdWJzdHJpbmcoMCwgaSksIHNob3J0dGV4dC5zdWJzdHJpbmcoMCwgaikpO1xuICAgICAgaWYgKGJlc3RfY29tbW9uLmxlbmd0aCA8IHN1ZmZpeExlbmd0aCArIHByZWZpeExlbmd0aCkge1xuICAgICAgICBiZXN0X2NvbW1vbiA9IHNob3J0dGV4dC5zdWJzdHJpbmcoXG4gICAgICAgICAgaiAtIHN1ZmZpeExlbmd0aCwgaikgKyBzaG9ydHRleHQuc3Vic3RyaW5nKGosIGogKyBwcmVmaXhMZW5ndGgpO1xuICAgICAgICBiZXN0X2xvbmd0ZXh0X2EgPSBsb25ndGV4dC5zdWJzdHJpbmcoMCwgaSAtIHN1ZmZpeExlbmd0aCk7XG4gICAgICAgIGJlc3RfbG9uZ3RleHRfYiA9IGxvbmd0ZXh0LnN1YnN0cmluZyhpICsgcHJlZml4TGVuZ3RoKTtcbiAgICAgICAgYmVzdF9zaG9ydHRleHRfYSA9IHNob3J0dGV4dC5zdWJzdHJpbmcoMCwgaiAtIHN1ZmZpeExlbmd0aCk7XG4gICAgICAgIGJlc3Rfc2hvcnR0ZXh0X2IgPSBzaG9ydHRleHQuc3Vic3RyaW5nKGogKyBwcmVmaXhMZW5ndGgpO1xuICAgICAgfVxuICAgIH1cbiAgICBpZiAoYmVzdF9jb21tb24ubGVuZ3RoICogMiA+PSBsb25ndGV4dC5sZW5ndGgpIHtcbiAgICAgIHJldHVybiBbXG4gICAgICAgIGJlc3RfbG9uZ3RleHRfYSwgYmVzdF9sb25ndGV4dF9iLFxuICAgICAgICBiZXN0X3Nob3J0dGV4dF9hLCBiZXN0X3Nob3J0dGV4dF9iLCBiZXN0X2NvbW1vblxuICAgICAgXTtcbiAgICB9IGVsc2Uge1xuICAgICAgcmV0dXJuIG51bGw7XG4gICAgfVxuICB9XG5cbiAgLy8gRmlyc3QgY2hlY2sgaWYgdGhlIHNlY29uZCBxdWFydGVyIGlzIHRoZSBzZWVkIGZvciBhIGhhbGYtbWF0Y2guXG4gIHZhciBobTEgPSBkaWZmX2hhbGZNYXRjaElfKGxvbmd0ZXh0LCBzaG9ydHRleHQsIE1hdGguY2VpbChsb25ndGV4dC5sZW5ndGggLyA0KSk7XG4gIC8vIENoZWNrIGFnYWluIGJhc2VkIG9uIHRoZSB0aGlyZCBxdWFydGVyLlxuICB2YXIgaG0yID0gZGlmZl9oYWxmTWF0Y2hJXyhsb25ndGV4dCwgc2hvcnR0ZXh0LCBNYXRoLmNlaWwobG9uZ3RleHQubGVuZ3RoIC8gMikpO1xuICB2YXIgaG07XG4gIGlmICghaG0xICYmICFobTIpIHtcbiAgICByZXR1cm4gbnVsbDtcbiAgfSBlbHNlIGlmICghaG0yKSB7XG4gICAgaG0gPSBobTE7XG4gIH0gZWxzZSBpZiAoIWhtMSkge1xuICAgIGhtID0gaG0yO1xuICB9IGVsc2Uge1xuICAgIC8vIEJvdGggbWF0Y2hlZC4gIFNlbGVjdCB0aGUgbG9uZ2VzdC5cbiAgICBobSA9IGhtMVs0XS5sZW5ndGggPiBobTJbNF0ubGVuZ3RoID8gaG0xIDogaG0yO1xuICB9XG5cbiAgLy8gQSBoYWxmLW1hdGNoIHdhcyBmb3VuZCwgc29ydCBvdXQgdGhlIHJldHVybiBkYXRhLlxuICB2YXIgdGV4dDFfYSwgdGV4dDFfYiwgdGV4dDJfYSwgdGV4dDJfYjtcbiAgaWYgKHRleHQxLmxlbmd0aCA+IHRleHQyLmxlbmd0aCkge1xuICAgIHRleHQxX2EgPSBobVswXTtcbiAgICB0ZXh0MV9iID0gaG1bMV07XG4gICAgdGV4dDJfYSA9IGhtWzJdO1xuICAgIHRleHQyX2IgPSBobVszXTtcbiAgfSBlbHNlIHtcbiAgICB0ZXh0Ml9hID0gaG1bMF07XG4gICAgdGV4dDJfYiA9IGhtWzFdO1xuICAgIHRleHQxX2EgPSBobVsyXTtcbiAgICB0ZXh0MV9iID0gaG1bM107XG4gIH1cbiAgdmFyIG1pZF9jb21tb24gPSBobVs0XTtcbiAgcmV0dXJuIFt0ZXh0MV9hLCB0ZXh0MV9iLCB0ZXh0Ml9hLCB0ZXh0Ml9iLCBtaWRfY29tbW9uXTtcbn07XG5cblxuLyoqXG4gKiBSZW9yZGVyIGFuZCBtZXJnZSBsaWtlIGVkaXQgc2VjdGlvbnMuICBNZXJnZSBlcXVhbGl0aWVzLlxuICogQW55IGVkaXQgc2VjdGlvbiBjYW4gbW92ZSBhcyBsb25nIGFzIGl0IGRvZXNuJ3QgY3Jvc3MgYW4gZXF1YWxpdHkuXG4gKiBAcGFyYW0ge0FycmF5fSBkaWZmcyBBcnJheSBvZiBkaWZmIHR1cGxlcy5cbiAqIEBwYXJhbSB7Ym9vbGVhbn0gZml4X3VuaWNvZGUgV2hldGhlciB0byBub3JtYWxpemUgdG8gYSB1bmljb2RlLWNvcnJlY3QgZGlmZlxuICovXG5mdW5jdGlvbiBkaWZmX2NsZWFudXBNZXJnZShkaWZmcywgZml4X3VuaWNvZGUpIHtcbiAgZGlmZnMucHVzaChbRElGRl9FUVVBTCwgJyddKTsgIC8vIEFkZCBhIGR1bW15IGVudHJ5IGF0IHRoZSBlbmQuXG4gIHZhciBwb2ludGVyID0gMDtcbiAgdmFyIGNvdW50X2RlbGV0ZSA9IDA7XG4gIHZhciBjb3VudF9pbnNlcnQgPSAwO1xuICB2YXIgdGV4dF9kZWxldGUgPSAnJztcbiAgdmFyIHRleHRfaW5zZXJ0ID0gJyc7XG4gIHZhciBjb21tb25sZW5ndGg7XG4gIHdoaWxlIChwb2ludGVyIDwgZGlmZnMubGVuZ3RoKSB7XG4gICAgaWYgKHBvaW50ZXIgPCBkaWZmcy5sZW5ndGggLSAxICYmICFkaWZmc1twb2ludGVyXVsxXSkge1xuICAgICAgZGlmZnMuc3BsaWNlKHBvaW50ZXIsIDEpO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIHN3aXRjaCAoZGlmZnNbcG9pbnRlcl1bMF0pIHtcbiAgICAgIGNhc2UgRElGRl9JTlNFUlQ6XG5cbiAgICAgICAgY291bnRfaW5zZXJ0Kys7XG4gICAgICAgIHRleHRfaW5zZXJ0ICs9IGRpZmZzW3BvaW50ZXJdWzFdO1xuICAgICAgICBwb2ludGVyKys7XG4gICAgICAgIGJyZWFrO1xuICAgICAgY2FzZSBESUZGX0RFTEVURTpcbiAgICAgICAgY291bnRfZGVsZXRlKys7XG4gICAgICAgIHRleHRfZGVsZXRlICs9IGRpZmZzW3BvaW50ZXJdWzFdO1xuICAgICAgICBwb2ludGVyKys7XG4gICAgICAgIGJyZWFrO1xuICAgICAgY2FzZSBESUZGX0VRVUFMOlxuICAgICAgICB2YXIgcHJldmlvdXNfZXF1YWxpdHkgPSBwb2ludGVyIC0gY291bnRfaW5zZXJ0IC0gY291bnRfZGVsZXRlIC0gMTtcbiAgICAgICAgaWYgKGZpeF91bmljb2RlKSB7XG4gICAgICAgICAgLy8gcHJldmVudCBzcGxpdHRpbmcgb2YgdW5pY29kZSBzdXJyb2dhdGUgcGFpcnMuICB3aGVuIGZpeF91bmljb2RlIGlzIHRydWUsXG4gICAgICAgICAgLy8gd2UgYXNzdW1lIHRoYXQgdGhlIG9sZCBhbmQgbmV3IHRleHQgaW4gdGhlIGRpZmYgYXJlIGNvbXBsZXRlIGFuZCBjb3JyZWN0XG4gICAgICAgICAgLy8gdW5pY29kZS1lbmNvZGVkIEpTIHN0cmluZ3MsIGJ1dCB0aGUgdHVwbGUgYm91bmRhcmllcyBtYXkgZmFsbCBiZXR3ZWVuXG4gICAgICAgICAgLy8gc3Vycm9nYXRlIHBhaXJzLiAgd2UgZml4IHRoaXMgYnkgc2hhdmluZyBvZmYgc3RyYXkgc3Vycm9nYXRlcyBmcm9tIHRoZSBlbmRcbiAgICAgICAgICAvLyBvZiB0aGUgcHJldmlvdXMgZXF1YWxpdHkgYW5kIHRoZSBiZWdpbm5pbmcgb2YgdGhpcyBlcXVhbGl0eS4gIHRoaXMgbWF5IGNyZWF0ZVxuICAgICAgICAgIC8vIGVtcHR5IGVxdWFsaXRpZXMgb3IgYSBjb21tb24gcHJlZml4IG9yIHN1ZmZpeC4gIGZvciBleGFtcGxlLCBpZiBBQiBhbmQgQUMgYXJlXG4gICAgICAgICAgLy8gZW1vamlzLCBgW1swLCAnQSddLCBbLTEsICdCQSddLCBbMCwgJ0MnXV1gIHdvdWxkIHR1cm4gaW50byBkZWxldGluZyAnQUJBQycgYW5kXG4gICAgICAgICAgLy8gaW5zZXJ0aW5nICdBQycsIGFuZCB0aGVuIHRoZSBjb21tb24gc3VmZml4ICdBQycgd2lsbCBiZSBlbGltaW5hdGVkLiAgaW4gdGhpc1xuICAgICAgICAgIC8vIHBhcnRpY3VsYXIgY2FzZSwgYm90aCBlcXVhbGl0aWVzIGdvIGF3YXksIHdlIGFic29yYiBhbnkgcHJldmlvdXMgaW5lcXVhbGl0aWVzLFxuICAgICAgICAgIC8vIGFuZCB3ZSBrZWVwIHNjYW5uaW5nIGZvciB0aGUgbmV4dCBlcXVhbGl0eSBiZWZvcmUgcmV3cml0aW5nIHRoZSB0dXBsZXMuXG4gICAgICAgICAgaWYgKHByZXZpb3VzX2VxdWFsaXR5ID49IDAgJiYgZW5kc193aXRoX3BhaXJfc3RhcnQoZGlmZnNbcHJldmlvdXNfZXF1YWxpdHldWzFdKSkge1xuICAgICAgICAgICAgdmFyIHN0cmF5ID0gZGlmZnNbcHJldmlvdXNfZXF1YWxpdHldWzFdLnNsaWNlKC0xKTtcbiAgICAgICAgICAgIGRpZmZzW3ByZXZpb3VzX2VxdWFsaXR5XVsxXSA9IGRpZmZzW3ByZXZpb3VzX2VxdWFsaXR5XVsxXS5zbGljZSgwLCAtMSk7XG4gICAgICAgICAgICB0ZXh0X2RlbGV0ZSA9IHN0cmF5ICsgdGV4dF9kZWxldGU7XG4gICAgICAgICAgICB0ZXh0X2luc2VydCA9IHN0cmF5ICsgdGV4dF9pbnNlcnQ7XG4gICAgICAgICAgICBpZiAoIWRpZmZzW3ByZXZpb3VzX2VxdWFsaXR5XVsxXSkge1xuICAgICAgICAgICAgICAvLyBlbXB0aWVkIG91dCBwcmV2aW91cyBlcXVhbGl0eSwgc28gZGVsZXRlIGl0IGFuZCBpbmNsdWRlIHByZXZpb3VzIGRlbGV0ZS9pbnNlcnRcbiAgICAgICAgICAgICAgZGlmZnMuc3BsaWNlKHByZXZpb3VzX2VxdWFsaXR5LCAxKTtcbiAgICAgICAgICAgICAgcG9pbnRlci0tO1xuICAgICAgICAgICAgICB2YXIgayA9IHByZXZpb3VzX2VxdWFsaXR5IC0gMTtcbiAgICAgICAgICAgICAgaWYgKGRpZmZzW2tdICYmIGRpZmZzW2tdWzBdID09PSBESUZGX0lOU0VSVCkge1xuICAgICAgICAgICAgICAgIGNvdW50X2luc2VydCsrO1xuICAgICAgICAgICAgICAgIHRleHRfaW5zZXJ0ID0gZGlmZnNba11bMV0gKyB0ZXh0X2luc2VydDtcbiAgICAgICAgICAgICAgICBrLS07XG4gICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgaWYgKGRpZmZzW2tdICYmIGRpZmZzW2tdWzBdID09PSBESUZGX0RFTEVURSkge1xuICAgICAgICAgICAgICAgIGNvdW50X2RlbGV0ZSsrO1xuICAgICAgICAgICAgICAgIHRleHRfZGVsZXRlID0gZGlmZnNba11bMV0gKyB0ZXh0X2RlbGV0ZTtcbiAgICAgICAgICAgICAgICBrLS07XG4gICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgcHJldmlvdXNfZXF1YWxpdHkgPSBrO1xuICAgICAgICAgICAgfVxuICAgICAgICAgIH1cbiAgICAgICAgICBpZiAoc3RhcnRzX3dpdGhfcGFpcl9lbmQoZGlmZnNbcG9pbnRlcl1bMV0pKSB7XG4gICAgICAgICAgICB2YXIgc3RyYXkgPSBkaWZmc1twb2ludGVyXVsxXS5jaGFyQXQoMCk7XG4gICAgICAgICAgICBkaWZmc1twb2ludGVyXVsxXSA9IGRpZmZzW3BvaW50ZXJdWzFdLnNsaWNlKDEpO1xuICAgICAgICAgICAgdGV4dF9kZWxldGUgKz0gc3RyYXk7XG4gICAgICAgICAgICB0ZXh0X2luc2VydCArPSBzdHJheTtcbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgICAgaWYgKHBvaW50ZXIgPCBkaWZmcy5sZW5ndGggLSAxICYmICFkaWZmc1twb2ludGVyXVsxXSkge1xuICAgICAgICAgIC8vIGZvciBlbXB0eSBlcXVhbGl0eSBub3QgYXQgZW5kLCB3YWl0IGZvciBuZXh0IGVxdWFsaXR5XG4gICAgICAgICAgZGlmZnMuc3BsaWNlKHBvaW50ZXIsIDEpO1xuICAgICAgICAgIGJyZWFrO1xuICAgICAgICB9XG4gICAgICAgIGlmICh0ZXh0X2RlbGV0ZS5sZW5ndGggPiAwIHx8IHRleHRfaW5zZXJ0Lmxlbmd0aCA+IDApIHtcbiAgICAgICAgICAvLyBub3RlIHRoYXQgZGlmZl9jb21tb25QcmVmaXggYW5kIGRpZmZfY29tbW9uU3VmZml4IGFyZSB1bmljb2RlLWF3YXJlXG4gICAgICAgICAgaWYgKHRleHRfZGVsZXRlLmxlbmd0aCA+IDAgJiYgdGV4dF9pbnNlcnQubGVuZ3RoID4gMCkge1xuICAgICAgICAgICAgLy8gRmFjdG9yIG91dCBhbnkgY29tbW9uIHByZWZpeGVzLlxuICAgICAgICAgICAgY29tbW9ubGVuZ3RoID0gZGlmZl9jb21tb25QcmVmaXgodGV4dF9pbnNlcnQsIHRleHRfZGVsZXRlKTtcbiAgICAgICAgICAgIGlmIChjb21tb25sZW5ndGggIT09IDApIHtcbiAgICAgICAgICAgICAgaWYgKHByZXZpb3VzX2VxdWFsaXR5ID49IDApIHtcbiAgICAgICAgICAgICAgICBkaWZmc1twcmV2aW91c19lcXVhbGl0eV1bMV0gKz0gdGV4dF9pbnNlcnQuc3Vic3RyaW5nKDAsIGNvbW1vbmxlbmd0aCk7XG4gICAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgZGlmZnMuc3BsaWNlKDAsIDAsIFtESUZGX0VRVUFMLCB0ZXh0X2luc2VydC5zdWJzdHJpbmcoMCwgY29tbW9ubGVuZ3RoKV0pO1xuICAgICAgICAgICAgICAgIHBvaW50ZXIrKztcbiAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICB0ZXh0X2luc2VydCA9IHRleHRfaW5zZXJ0LnN1YnN0cmluZyhjb21tb25sZW5ndGgpO1xuICAgICAgICAgICAgICB0ZXh0X2RlbGV0ZSA9IHRleHRfZGVsZXRlLnN1YnN0cmluZyhjb21tb25sZW5ndGgpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgLy8gRmFjdG9yIG91dCBhbnkgY29tbW9uIHN1ZmZpeGVzLlxuICAgICAgICAgICAgY29tbW9ubGVuZ3RoID0gZGlmZl9jb21tb25TdWZmaXgodGV4dF9pbnNlcnQsIHRleHRfZGVsZXRlKTtcbiAgICAgICAgICAgIGlmIChjb21tb25sZW5ndGggIT09IDApIHtcbiAgICAgICAgICAgICAgZGlmZnNbcG9pbnRlcl1bMV0gPVxuICAgICAgICAgICAgICAgIHRleHRfaW5zZXJ0LnN1YnN0cmluZyh0ZXh0X2luc2VydC5sZW5ndGggLSBjb21tb25sZW5ndGgpICsgZGlmZnNbcG9pbnRlcl1bMV07XG4gICAgICAgICAgICAgIHRleHRfaW5zZXJ0ID0gdGV4dF9pbnNlcnQuc3Vic3RyaW5nKDAsIHRleHRfaW5zZXJ0Lmxlbmd0aCAtIGNvbW1vbmxlbmd0aCk7XG4gICAgICAgICAgICAgIHRleHRfZGVsZXRlID0gdGV4dF9kZWxldGUuc3Vic3RyaW5nKDAsIHRleHRfZGVsZXRlLmxlbmd0aCAtIGNvbW1vbmxlbmd0aCk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgfVxuICAgICAgICAgIC8vIERlbGV0ZSB0aGUgb2ZmZW5kaW5nIHJlY29yZHMgYW5kIGFkZCB0aGUgbWVyZ2VkIG9uZXMuXG4gICAgICAgICAgdmFyIG4gPSBjb3VudF9pbnNlcnQgKyBjb3VudF9kZWxldGU7XG4gICAgICAgICAgaWYgKHRleHRfZGVsZXRlLmxlbmd0aCA9PT0gMCAmJiB0ZXh0X2luc2VydC5sZW5ndGggPT09IDApIHtcbiAgICAgICAgICAgIGRpZmZzLnNwbGljZShwb2ludGVyIC0gbiwgbik7XG4gICAgICAgICAgICBwb2ludGVyID0gcG9pbnRlciAtIG47XG4gICAgICAgICAgfSBlbHNlIGlmICh0ZXh0X2RlbGV0ZS5sZW5ndGggPT09IDApIHtcbiAgICAgICAgICAgIGRpZmZzLnNwbGljZShwb2ludGVyIC0gbiwgbiwgW0RJRkZfSU5TRVJULCB0ZXh0X2luc2VydF0pO1xuICAgICAgICAgICAgcG9pbnRlciA9IHBvaW50ZXIgLSBuICsgMTtcbiAgICAgICAgICB9IGVsc2UgaWYgKHRleHRfaW5zZXJ0Lmxlbmd0aCA9PT0gMCkge1xuICAgICAgICAgICAgZGlmZnMuc3BsaWNlKHBvaW50ZXIgLSBuLCBuLCBbRElGRl9ERUxFVEUsIHRleHRfZGVsZXRlXSk7XG4gICAgICAgICAgICBwb2ludGVyID0gcG9pbnRlciAtIG4gKyAxO1xuICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICBkaWZmcy5zcGxpY2UocG9pbnRlciAtIG4sIG4sIFtESUZGX0RFTEVURSwgdGV4dF9kZWxldGVdLCBbRElGRl9JTlNFUlQsIHRleHRfaW5zZXJ0XSk7XG4gICAgICAgICAgICBwb2ludGVyID0gcG9pbnRlciAtIG4gKyAyO1xuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgICBpZiAocG9pbnRlciAhPT0gMCAmJiBkaWZmc1twb2ludGVyIC0gMV1bMF0gPT09IERJRkZfRVFVQUwpIHtcbiAgICAgICAgICAvLyBNZXJnZSB0aGlzIGVxdWFsaXR5IHdpdGggdGhlIHByZXZpb3VzIG9uZS5cbiAgICAgICAgICBkaWZmc1twb2ludGVyIC0gMV1bMV0gKz0gZGlmZnNbcG9pbnRlcl1bMV07XG4gICAgICAgICAgZGlmZnMuc3BsaWNlKHBvaW50ZXIsIDEpO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIHBvaW50ZXIrKztcbiAgICAgICAgfVxuICAgICAgICBjb3VudF9pbnNlcnQgPSAwO1xuICAgICAgICBjb3VudF9kZWxldGUgPSAwO1xuICAgICAgICB0ZXh0X2RlbGV0ZSA9ICcnO1xuICAgICAgICB0ZXh0X2luc2VydCA9ICcnO1xuICAgICAgICBicmVhaztcbiAgICB9XG4gIH1cbiAgaWYgKGRpZmZzW2RpZmZzLmxlbmd0aCAtIDFdWzFdID09PSAnJykge1xuICAgIGRpZmZzLnBvcCgpOyAgLy8gUmVtb3ZlIHRoZSBkdW1teSBlbnRyeSBhdCB0aGUgZW5kLlxuICB9XG5cbiAgLy8gU2Vjb25kIHBhc3M6IGxvb2sgZm9yIHNpbmdsZSBlZGl0cyBzdXJyb3VuZGVkIG9uIGJvdGggc2lkZXMgYnkgZXF1YWxpdGllc1xuICAvLyB3aGljaCBjYW4gYmUgc2hpZnRlZCBzaWRld2F5cyB0byBlbGltaW5hdGUgYW4gZXF1YWxpdHkuXG4gIC8vIGUuZzogQTxpbnM+QkE8L2lucz5DIC0+IDxpbnM+QUI8L2lucz5BQ1xuICB2YXIgY2hhbmdlcyA9IGZhbHNlO1xuICBwb2ludGVyID0gMTtcbiAgLy8gSW50ZW50aW9uYWxseSBpZ25vcmUgdGhlIGZpcnN0IGFuZCBsYXN0IGVsZW1lbnQgKGRvbid0IG5lZWQgY2hlY2tpbmcpLlxuICB3aGlsZSAocG9pbnRlciA8IGRpZmZzLmxlbmd0aCAtIDEpIHtcbiAgICBpZiAoZGlmZnNbcG9pbnRlciAtIDFdWzBdID09PSBESUZGX0VRVUFMICYmXG4gICAgICBkaWZmc1twb2ludGVyICsgMV1bMF0gPT09IERJRkZfRVFVQUwpIHtcbiAgICAgIC8vIFRoaXMgaXMgYSBzaW5nbGUgZWRpdCBzdXJyb3VuZGVkIGJ5IGVxdWFsaXRpZXMuXG4gICAgICBpZiAoZGlmZnNbcG9pbnRlcl1bMV0uc3Vic3RyaW5nKGRpZmZzW3BvaW50ZXJdWzFdLmxlbmd0aCAtXG4gICAgICAgIGRpZmZzW3BvaW50ZXIgLSAxXVsxXS5sZW5ndGgpID09PSBkaWZmc1twb2ludGVyIC0gMV1bMV0pIHtcbiAgICAgICAgLy8gU2hpZnQgdGhlIGVkaXQgb3ZlciB0aGUgcHJldmlvdXMgZXF1YWxpdHkuXG4gICAgICAgIGRpZmZzW3BvaW50ZXJdWzFdID0gZGlmZnNbcG9pbnRlciAtIDFdWzFdICtcbiAgICAgICAgICBkaWZmc1twb2ludGVyXVsxXS5zdWJzdHJpbmcoMCwgZGlmZnNbcG9pbnRlcl1bMV0ubGVuZ3RoIC1cbiAgICAgICAgICAgIGRpZmZzW3BvaW50ZXIgLSAxXVsxXS5sZW5ndGgpO1xuICAgICAgICBkaWZmc1twb2ludGVyICsgMV1bMV0gPSBkaWZmc1twb2ludGVyIC0gMV1bMV0gKyBkaWZmc1twb2ludGVyICsgMV1bMV07XG4gICAgICAgIGRpZmZzLnNwbGljZShwb2ludGVyIC0gMSwgMSk7XG4gICAgICAgIGNoYW5nZXMgPSB0cnVlO1xuICAgICAgfSBlbHNlIGlmIChkaWZmc1twb2ludGVyXVsxXS5zdWJzdHJpbmcoMCwgZGlmZnNbcG9pbnRlciArIDFdWzFdLmxlbmd0aCkgPT1cbiAgICAgICAgZGlmZnNbcG9pbnRlciArIDFdWzFdKSB7XG4gICAgICAgIC8vIFNoaWZ0IHRoZSBlZGl0IG92ZXIgdGhlIG5leHQgZXF1YWxpdHkuXG4gICAgICAgIGRpZmZzW3BvaW50ZXIgLSAxXVsxXSArPSBkaWZmc1twb2ludGVyICsgMV1bMV07XG4gICAgICAgIGRpZmZzW3BvaW50ZXJdWzFdID1cbiAgICAgICAgICBkaWZmc1twb2ludGVyXVsxXS5zdWJzdHJpbmcoZGlmZnNbcG9pbnRlciArIDFdWzFdLmxlbmd0aCkgK1xuICAgICAgICAgIGRpZmZzW3BvaW50ZXIgKyAxXVsxXTtcbiAgICAgICAgZGlmZnMuc3BsaWNlKHBvaW50ZXIgKyAxLCAxKTtcbiAgICAgICAgY2hhbmdlcyA9IHRydWU7XG4gICAgICB9XG4gICAgfVxuICAgIHBvaW50ZXIrKztcbiAgfVxuICAvLyBJZiBzaGlmdHMgd2VyZSBtYWRlLCB0aGUgZGlmZiBuZWVkcyByZW9yZGVyaW5nIGFuZCBhbm90aGVyIHNoaWZ0IHN3ZWVwLlxuICBpZiAoY2hhbmdlcykge1xuICAgIGRpZmZfY2xlYW51cE1lcmdlKGRpZmZzLCBmaXhfdW5pY29kZSk7XG4gIH1cbn07XG5cbmZ1bmN0aW9uIGlzX3N1cnJvZ2F0ZV9wYWlyX3N0YXJ0KGNoYXJDb2RlKSB7XG4gIHJldHVybiBjaGFyQ29kZSA+PSAweEQ4MDAgJiYgY2hhckNvZGUgPD0gMHhEQkZGO1xufVxuXG5mdW5jdGlvbiBpc19zdXJyb2dhdGVfcGFpcl9lbmQoY2hhckNvZGUpIHtcbiAgcmV0dXJuIGNoYXJDb2RlID49IDB4REMwMCAmJiBjaGFyQ29kZSA8PSAweERGRkY7XG59XG5cbmZ1bmN0aW9uIHN0YXJ0c193aXRoX3BhaXJfZW5kKHN0cikge1xuICByZXR1cm4gaXNfc3Vycm9nYXRlX3BhaXJfZW5kKHN0ci5jaGFyQ29kZUF0KDApKTtcbn1cblxuZnVuY3Rpb24gZW5kc193aXRoX3BhaXJfc3RhcnQoc3RyKSB7XG4gIHJldHVybiBpc19zdXJyb2dhdGVfcGFpcl9zdGFydChzdHIuY2hhckNvZGVBdChzdHIubGVuZ3RoIC0gMSkpO1xufVxuXG5mdW5jdGlvbiByZW1vdmVfZW1wdHlfdHVwbGVzKHR1cGxlcykge1xuICB2YXIgcmV0ID0gW107XG4gIGZvciAodmFyIGkgPSAwOyBpIDwgdHVwbGVzLmxlbmd0aDsgaSsrKSB7XG4gICAgaWYgKHR1cGxlc1tpXVsxXS5sZW5ndGggPiAwKSB7XG4gICAgICByZXQucHVzaCh0dXBsZXNbaV0pO1xuICAgIH1cbiAgfVxuICByZXR1cm4gcmV0O1xufVxuXG5mdW5jdGlvbiBtYWtlX2VkaXRfc3BsaWNlKGJlZm9yZSwgb2xkTWlkZGxlLCBuZXdNaWRkbGUsIGFmdGVyKSB7XG4gIGlmIChlbmRzX3dpdGhfcGFpcl9zdGFydChiZWZvcmUpIHx8IHN0YXJ0c193aXRoX3BhaXJfZW5kKGFmdGVyKSkge1xuICAgIHJldHVybiBudWxsO1xuICB9XG4gIHJldHVybiByZW1vdmVfZW1wdHlfdHVwbGVzKFtcbiAgICBbRElGRl9FUVVBTCwgYmVmb3JlXSxcbiAgICBbRElGRl9ERUxFVEUsIG9sZE1pZGRsZV0sXG4gICAgW0RJRkZfSU5TRVJULCBuZXdNaWRkbGVdLFxuICAgIFtESUZGX0VRVUFMLCBhZnRlcl1cbiAgXSk7XG59XG5cbmZ1bmN0aW9uIGZpbmRfY3Vyc29yX2VkaXRfZGlmZihvbGRUZXh0LCBuZXdUZXh0LCBjdXJzb3JfcG9zKSB7XG4gIC8vIG5vdGU6IHRoaXMgcnVucyBhZnRlciBlcXVhbGl0eSBjaGVjayBoYXMgcnVsZWQgb3V0IGV4YWN0IGVxdWFsaXR5XG4gIHZhciBvbGRSYW5nZSA9IHR5cGVvZiBjdXJzb3JfcG9zID09PSAnbnVtYmVyJyA/XG4gICAgeyBpbmRleDogY3Vyc29yX3BvcywgbGVuZ3RoOiAwIH0gOiBjdXJzb3JfcG9zLm9sZFJhbmdlO1xuICB2YXIgbmV3UmFuZ2UgPSB0eXBlb2YgY3Vyc29yX3BvcyA9PT0gJ251bWJlcicgP1xuICAgIG51bGwgOiBjdXJzb3JfcG9zLm5ld1JhbmdlO1xuICAvLyB0YWtlIGludG8gYWNjb3VudCB0aGUgb2xkIGFuZCBuZXcgc2VsZWN0aW9uIHRvIGdlbmVyYXRlIHRoZSBiZXN0IGRpZmZcbiAgLy8gcG9zc2libGUgZm9yIGEgdGV4dCBlZGl0LiAgZm9yIGV4YW1wbGUsIGEgdGV4dCBjaGFuZ2UgZnJvbSBcInh4eFwiIHRvIFwieHhcIlxuICAvLyBjb3VsZCBiZSBhIGRlbGV0ZSBvciBmb3J3YXJkcy1kZWxldGUgb2YgYW55IG9uZSBvZiB0aGUgeCdzLCBvciB0aGVcbiAgLy8gcmVzdWx0IG9mIHNlbGVjdGluZyB0d28gb2YgdGhlIHgncyBhbmQgdHlwaW5nIFwieFwiLlxuICB2YXIgb2xkTGVuZ3RoID0gb2xkVGV4dC5sZW5ndGg7XG4gIHZhciBuZXdMZW5ndGggPSBuZXdUZXh0Lmxlbmd0aDtcbiAgaWYgKG9sZFJhbmdlLmxlbmd0aCA9PT0gMCAmJiAobmV3UmFuZ2UgPT09IG51bGwgfHwgbmV3UmFuZ2UubGVuZ3RoID09PSAwKSkge1xuICAgIC8vIHNlZSBpZiB3ZSBoYXZlIGFuIGluc2VydCBvciBkZWxldGUgYmVmb3JlIG9yIGFmdGVyIGN1cnNvclxuICAgIHZhciBvbGRDdXJzb3IgPSBvbGRSYW5nZS5pbmRleDtcbiAgICB2YXIgb2xkQmVmb3JlID0gb2xkVGV4dC5zbGljZSgwLCBvbGRDdXJzb3IpO1xuICAgIHZhciBvbGRBZnRlciA9IG9sZFRleHQuc2xpY2Uob2xkQ3Vyc29yKTtcbiAgICB2YXIgbWF5YmVOZXdDdXJzb3IgPSBuZXdSYW5nZSA/IG5ld1JhbmdlLmluZGV4IDogbnVsbDtcbiAgICBlZGl0QmVmb3JlOiB7XG4gICAgICAvLyBpcyB0aGlzIGFuIGluc2VydCBvciBkZWxldGUgcmlnaHQgYmVmb3JlIG9sZEN1cnNvcj9cbiAgICAgIHZhciBuZXdDdXJzb3IgPSBvbGRDdXJzb3IgKyBuZXdMZW5ndGggLSBvbGRMZW5ndGg7XG4gICAgICBpZiAobWF5YmVOZXdDdXJzb3IgIT09IG51bGwgJiYgbWF5YmVOZXdDdXJzb3IgIT09IG5ld0N1cnNvcikge1xuICAgICAgICBicmVhayBlZGl0QmVmb3JlO1xuICAgICAgfVxuICAgICAgaWYgKG5ld0N1cnNvciA8IDAgfHwgbmV3Q3Vyc29yID4gbmV3TGVuZ3RoKSB7XG4gICAgICAgIGJyZWFrIGVkaXRCZWZvcmU7XG4gICAgICB9XG4gICAgICB2YXIgbmV3QmVmb3JlID0gbmV3VGV4dC5zbGljZSgwLCBuZXdDdXJzb3IpO1xuICAgICAgdmFyIG5ld0FmdGVyID0gbmV3VGV4dC5zbGljZShuZXdDdXJzb3IpO1xuICAgICAgaWYgKG5ld0FmdGVyICE9PSBvbGRBZnRlcikge1xuICAgICAgICBicmVhayBlZGl0QmVmb3JlO1xuICAgICAgfVxuICAgICAgdmFyIHByZWZpeExlbmd0aCA9IE1hdGgubWluKG9sZEN1cnNvciwgbmV3Q3Vyc29yKTtcbiAgICAgIHZhciBvbGRQcmVmaXggPSBvbGRCZWZvcmUuc2xpY2UoMCwgcHJlZml4TGVuZ3RoKTtcbiAgICAgIHZhciBuZXdQcmVmaXggPSBuZXdCZWZvcmUuc2xpY2UoMCwgcHJlZml4TGVuZ3RoKTtcbiAgICAgIGlmIChvbGRQcmVmaXggIT09IG5ld1ByZWZpeCkge1xuICAgICAgICBicmVhayBlZGl0QmVmb3JlO1xuICAgICAgfVxuICAgICAgdmFyIG9sZE1pZGRsZSA9IG9sZEJlZm9yZS5zbGljZShwcmVmaXhMZW5ndGgpO1xuICAgICAgdmFyIG5ld01pZGRsZSA9IG5ld0JlZm9yZS5zbGljZShwcmVmaXhMZW5ndGgpO1xuICAgICAgcmV0dXJuIG1ha2VfZWRpdF9zcGxpY2Uob2xkUHJlZml4LCBvbGRNaWRkbGUsIG5ld01pZGRsZSwgb2xkQWZ0ZXIpO1xuICAgIH1cbiAgICBlZGl0QWZ0ZXI6IHtcbiAgICAgIC8vIGlzIHRoaXMgYW4gaW5zZXJ0IG9yIGRlbGV0ZSByaWdodCBhZnRlciBvbGRDdXJzb3I/XG4gICAgICBpZiAobWF5YmVOZXdDdXJzb3IgIT09IG51bGwgJiYgbWF5YmVOZXdDdXJzb3IgIT09IG9sZEN1cnNvcikge1xuICAgICAgICBicmVhayBlZGl0QWZ0ZXI7XG4gICAgICB9XG4gICAgICB2YXIgY3Vyc29yID0gb2xkQ3Vyc29yO1xuICAgICAgdmFyIG5ld0JlZm9yZSA9IG5ld1RleHQuc2xpY2UoMCwgY3Vyc29yKTtcbiAgICAgIHZhciBuZXdBZnRlciA9IG5ld1RleHQuc2xpY2UoY3Vyc29yKTtcbiAgICAgIGlmIChuZXdCZWZvcmUgIT09IG9sZEJlZm9yZSkge1xuICAgICAgICBicmVhayBlZGl0QWZ0ZXI7XG4gICAgICB9XG4gICAgICB2YXIgc3VmZml4TGVuZ3RoID0gTWF0aC5taW4ob2xkTGVuZ3RoIC0gY3Vyc29yLCBuZXdMZW5ndGggLSBjdXJzb3IpO1xuICAgICAgdmFyIG9sZFN1ZmZpeCA9IG9sZEFmdGVyLnNsaWNlKG9sZEFmdGVyLmxlbmd0aCAtIHN1ZmZpeExlbmd0aCk7XG4gICAgICB2YXIgbmV3U3VmZml4ID0gbmV3QWZ0ZXIuc2xpY2UobmV3QWZ0ZXIubGVuZ3RoIC0gc3VmZml4TGVuZ3RoKTtcbiAgICAgIGlmIChvbGRTdWZmaXggIT09IG5ld1N1ZmZpeCkge1xuICAgICAgICBicmVhayBlZGl0QWZ0ZXI7XG4gICAgICB9XG4gICAgICB2YXIgb2xkTWlkZGxlID0gb2xkQWZ0ZXIuc2xpY2UoMCwgb2xkQWZ0ZXIubGVuZ3RoIC0gc3VmZml4TGVuZ3RoKTtcbiAgICAgIHZhciBuZXdNaWRkbGUgPSBuZXdBZnRlci5zbGljZSgwLCBuZXdBZnRlci5sZW5ndGggLSBzdWZmaXhMZW5ndGgpO1xuICAgICAgcmV0dXJuIG1ha2VfZWRpdF9zcGxpY2Uob2xkQmVmb3JlLCBvbGRNaWRkbGUsIG5ld01pZGRsZSwgb2xkU3VmZml4KTtcbiAgICB9XG4gIH1cbiAgaWYgKG9sZFJhbmdlLmxlbmd0aCA+IDAgJiYgbmV3UmFuZ2UgJiYgbmV3UmFuZ2UubGVuZ3RoID09PSAwKSB7XG4gICAgcmVwbGFjZVJhbmdlOiB7XG4gICAgICAvLyBzZWUgaWYgZGlmZiBjb3VsZCBiZSBhIHNwbGljZSBvZiB0aGUgb2xkIHNlbGVjdGlvbiByYW5nZVxuICAgICAgdmFyIG9sZFByZWZpeCA9IG9sZFRleHQuc2xpY2UoMCwgb2xkUmFuZ2UuaW5kZXgpO1xuICAgICAgdmFyIG9sZFN1ZmZpeCA9IG9sZFRleHQuc2xpY2Uob2xkUmFuZ2UuaW5kZXggKyBvbGRSYW5nZS5sZW5ndGgpO1xuICAgICAgdmFyIHByZWZpeExlbmd0aCA9IG9sZFByZWZpeC5sZW5ndGg7XG4gICAgICB2YXIgc3VmZml4TGVuZ3RoID0gb2xkU3VmZml4Lmxlbmd0aDtcbiAgICAgIGlmIChuZXdMZW5ndGggPCBwcmVmaXhMZW5ndGggKyBzdWZmaXhMZW5ndGgpIHtcbiAgICAgICAgYnJlYWsgcmVwbGFjZVJhbmdlO1xuICAgICAgfVxuICAgICAgdmFyIG5ld1ByZWZpeCA9IG5ld1RleHQuc2xpY2UoMCwgcHJlZml4TGVuZ3RoKTtcbiAgICAgIHZhciBuZXdTdWZmaXggPSBuZXdUZXh0LnNsaWNlKG5ld0xlbmd0aCAtIHN1ZmZpeExlbmd0aCk7XG4gICAgICBpZiAob2xkUHJlZml4ICE9PSBuZXdQcmVmaXggfHwgb2xkU3VmZml4ICE9PSBuZXdTdWZmaXgpIHtcbiAgICAgICAgYnJlYWsgcmVwbGFjZVJhbmdlO1xuICAgICAgfVxuICAgICAgdmFyIG9sZE1pZGRsZSA9IG9sZFRleHQuc2xpY2UocHJlZml4TGVuZ3RoLCBvbGRMZW5ndGggLSBzdWZmaXhMZW5ndGgpO1xuICAgICAgdmFyIG5ld01pZGRsZSA9IG5ld1RleHQuc2xpY2UocHJlZml4TGVuZ3RoLCBuZXdMZW5ndGggLSBzdWZmaXhMZW5ndGgpO1xuICAgICAgcmV0dXJuIG1ha2VfZWRpdF9zcGxpY2Uob2xkUHJlZml4LCBvbGRNaWRkbGUsIG5ld01pZGRsZSwgb2xkU3VmZml4KTtcbiAgICB9XG4gIH1cblxuICByZXR1cm4gbnVsbDtcbn1cblxuZnVuY3Rpb24gZGlmZih0ZXh0MSwgdGV4dDIsIGN1cnNvcl9wb3MpIHtcbiAgLy8gb25seSBwYXNzIGZpeF91bmljb2RlPXRydWUgYXQgdGhlIHRvcCBsZXZlbCwgbm90IHdoZW4gZGlmZl9tYWluIGlzXG4gIC8vIHJlY3Vyc2l2ZWx5IGludm9rZWRcbiAgcmV0dXJuIGRpZmZfbWFpbih0ZXh0MSwgdGV4dDIsIGN1cnNvcl9wb3MsIHRydWUpO1xufVxuXG5kaWZmLklOU0VSVCA9IERJRkZfSU5TRVJUO1xuZGlmZi5ERUxFVEUgPSBESUZGX0RFTEVURTtcbmRpZmYuRVFVQUwgPSBESUZGX0VRVUFMO1xuXG5tb2R1bGUuZXhwb3J0cyA9IGRpZmY7XG4iLCIvKipcbiAqIGxvZGFzaCAoQ3VzdG9tIEJ1aWxkKSA8aHR0cHM6Ly9sb2Rhc2guY29tLz5cbiAqIEJ1aWxkOiBgbG9kYXNoIG1vZHVsYXJpemUgZXhwb3J0cz1cIm5wbVwiIC1vIC4vYFxuICogQ29weXJpZ2h0IGpRdWVyeSBGb3VuZGF0aW9uIGFuZCBvdGhlciBjb250cmlidXRvcnMgPGh0dHBzOi8vanF1ZXJ5Lm9yZy8+XG4gKiBSZWxlYXNlZCB1bmRlciBNSVQgbGljZW5zZSA8aHR0cHM6Ly9sb2Rhc2guY29tL2xpY2Vuc2U+XG4gKiBCYXNlZCBvbiBVbmRlcnNjb3JlLmpzIDEuOC4zIDxodHRwOi8vdW5kZXJzY29yZWpzLm9yZy9MSUNFTlNFPlxuICogQ29weXJpZ2h0IEplcmVteSBBc2hrZW5hcywgRG9jdW1lbnRDbG91ZCBhbmQgSW52ZXN0aWdhdGl2ZSBSZXBvcnRlcnMgJiBFZGl0b3JzXG4gKi9cblxuLyoqIFVzZWQgYXMgdGhlIHNpemUgdG8gZW5hYmxlIGxhcmdlIGFycmF5IG9wdGltaXphdGlvbnMuICovXG52YXIgTEFSR0VfQVJSQVlfU0laRSA9IDIwMDtcblxuLyoqIFVzZWQgdG8gc3RhbmQtaW4gZm9yIGB1bmRlZmluZWRgIGhhc2ggdmFsdWVzLiAqL1xudmFyIEhBU0hfVU5ERUZJTkVEID0gJ19fbG9kYXNoX2hhc2hfdW5kZWZpbmVkX18nO1xuXG4vKiogVXNlZCBhcyByZWZlcmVuY2VzIGZvciB2YXJpb3VzIGBOdW1iZXJgIGNvbnN0YW50cy4gKi9cbnZhciBNQVhfU0FGRV9JTlRFR0VSID0gOTAwNzE5OTI1NDc0MDk5MTtcblxuLyoqIGBPYmplY3QjdG9TdHJpbmdgIHJlc3VsdCByZWZlcmVuY2VzLiAqL1xudmFyIGFyZ3NUYWcgPSAnW29iamVjdCBBcmd1bWVudHNdJyxcbiAgICBhcnJheVRhZyA9ICdbb2JqZWN0IEFycmF5XScsXG4gICAgYm9vbFRhZyA9ICdbb2JqZWN0IEJvb2xlYW5dJyxcbiAgICBkYXRlVGFnID0gJ1tvYmplY3QgRGF0ZV0nLFxuICAgIGVycm9yVGFnID0gJ1tvYmplY3QgRXJyb3JdJyxcbiAgICBmdW5jVGFnID0gJ1tvYmplY3QgRnVuY3Rpb25dJyxcbiAgICBnZW5UYWcgPSAnW29iamVjdCBHZW5lcmF0b3JGdW5jdGlvbl0nLFxuICAgIG1hcFRhZyA9ICdbb2JqZWN0IE1hcF0nLFxuICAgIG51bWJlclRhZyA9ICdbb2JqZWN0IE51bWJlcl0nLFxuICAgIG9iamVjdFRhZyA9ICdbb2JqZWN0IE9iamVjdF0nLFxuICAgIHByb21pc2VUYWcgPSAnW29iamVjdCBQcm9taXNlXScsXG4gICAgcmVnZXhwVGFnID0gJ1tvYmplY3QgUmVnRXhwXScsXG4gICAgc2V0VGFnID0gJ1tvYmplY3QgU2V0XScsXG4gICAgc3RyaW5nVGFnID0gJ1tvYmplY3QgU3RyaW5nXScsXG4gICAgc3ltYm9sVGFnID0gJ1tvYmplY3QgU3ltYm9sXScsXG4gICAgd2Vha01hcFRhZyA9ICdbb2JqZWN0IFdlYWtNYXBdJztcblxudmFyIGFycmF5QnVmZmVyVGFnID0gJ1tvYmplY3QgQXJyYXlCdWZmZXJdJyxcbiAgICBkYXRhVmlld1RhZyA9ICdbb2JqZWN0IERhdGFWaWV3XScsXG4gICAgZmxvYXQzMlRhZyA9ICdbb2JqZWN0IEZsb2F0MzJBcnJheV0nLFxuICAgIGZsb2F0NjRUYWcgPSAnW29iamVjdCBGbG9hdDY0QXJyYXldJyxcbiAgICBpbnQ4VGFnID0gJ1tvYmplY3QgSW50OEFycmF5XScsXG4gICAgaW50MTZUYWcgPSAnW29iamVjdCBJbnQxNkFycmF5XScsXG4gICAgaW50MzJUYWcgPSAnW29iamVjdCBJbnQzMkFycmF5XScsXG4gICAgdWludDhUYWcgPSAnW29iamVjdCBVaW50OEFycmF5XScsXG4gICAgdWludDhDbGFtcGVkVGFnID0gJ1tvYmplY3QgVWludDhDbGFtcGVkQXJyYXldJyxcbiAgICB1aW50MTZUYWcgPSAnW29iamVjdCBVaW50MTZBcnJheV0nLFxuICAgIHVpbnQzMlRhZyA9ICdbb2JqZWN0IFVpbnQzMkFycmF5XSc7XG5cbi8qKlxuICogVXNlZCB0byBtYXRjaCBgUmVnRXhwYFxuICogW3N5bnRheCBjaGFyYWN0ZXJzXShodHRwOi8vZWNtYS1pbnRlcm5hdGlvbmFsLm9yZy9lY21hLTI2Mi83LjAvI3NlYy1wYXR0ZXJucykuXG4gKi9cbnZhciByZVJlZ0V4cENoYXIgPSAvW1xcXFxeJC4qKz8oKVtcXF17fXxdL2c7XG5cbi8qKiBVc2VkIHRvIG1hdGNoIGBSZWdFeHBgIGZsYWdzIGZyb20gdGhlaXIgY29lcmNlZCBzdHJpbmcgdmFsdWVzLiAqL1xudmFyIHJlRmxhZ3MgPSAvXFx3KiQvO1xuXG4vKiogVXNlZCB0byBkZXRlY3QgaG9zdCBjb25zdHJ1Y3RvcnMgKFNhZmFyaSkuICovXG52YXIgcmVJc0hvc3RDdG9yID0gL15cXFtvYmplY3QgLis/Q29uc3RydWN0b3JcXF0kLztcblxuLyoqIFVzZWQgdG8gZGV0ZWN0IHVuc2lnbmVkIGludGVnZXIgdmFsdWVzLiAqL1xudmFyIHJlSXNVaW50ID0gL14oPzowfFsxLTldXFxkKikkLztcblxuLyoqIFVzZWQgdG8gaWRlbnRpZnkgYHRvU3RyaW5nVGFnYCB2YWx1ZXMgc3VwcG9ydGVkIGJ5IGBfLmNsb25lYC4gKi9cbnZhciBjbG9uZWFibGVUYWdzID0ge307XG5jbG9uZWFibGVUYWdzW2FyZ3NUYWddID0gY2xvbmVhYmxlVGFnc1thcnJheVRhZ10gPVxuY2xvbmVhYmxlVGFnc1thcnJheUJ1ZmZlclRhZ10gPSBjbG9uZWFibGVUYWdzW2RhdGFWaWV3VGFnXSA9XG5jbG9uZWFibGVUYWdzW2Jvb2xUYWddID0gY2xvbmVhYmxlVGFnc1tkYXRlVGFnXSA9XG5jbG9uZWFibGVUYWdzW2Zsb2F0MzJUYWddID0gY2xvbmVhYmxlVGFnc1tmbG9hdDY0VGFnXSA9XG5jbG9uZWFibGVUYWdzW2ludDhUYWddID0gY2xvbmVhYmxlVGFnc1tpbnQxNlRhZ10gPVxuY2xvbmVhYmxlVGFnc1tpbnQzMlRhZ10gPSBjbG9uZWFibGVUYWdzW21hcFRhZ10gPVxuY2xvbmVhYmxlVGFnc1tudW1iZXJUYWddID0gY2xvbmVhYmxlVGFnc1tvYmplY3RUYWddID1cbmNsb25lYWJsZVRhZ3NbcmVnZXhwVGFnXSA9IGNsb25lYWJsZVRhZ3Nbc2V0VGFnXSA9XG5jbG9uZWFibGVUYWdzW3N0cmluZ1RhZ10gPSBjbG9uZWFibGVUYWdzW3N5bWJvbFRhZ10gPVxuY2xvbmVhYmxlVGFnc1t1aW50OFRhZ10gPSBjbG9uZWFibGVUYWdzW3VpbnQ4Q2xhbXBlZFRhZ10gPVxuY2xvbmVhYmxlVGFnc1t1aW50MTZUYWddID0gY2xvbmVhYmxlVGFnc1t1aW50MzJUYWddID0gdHJ1ZTtcbmNsb25lYWJsZVRhZ3NbZXJyb3JUYWddID0gY2xvbmVhYmxlVGFnc1tmdW5jVGFnXSA9XG5jbG9uZWFibGVUYWdzW3dlYWtNYXBUYWddID0gZmFsc2U7XG5cbi8qKiBEZXRlY3QgZnJlZSB2YXJpYWJsZSBgZ2xvYmFsYCBmcm9tIE5vZGUuanMuICovXG52YXIgZnJlZUdsb2JhbCA9IHR5cGVvZiBnbG9iYWwgPT0gJ29iamVjdCcgJiYgZ2xvYmFsICYmIGdsb2JhbC5PYmplY3QgPT09IE9iamVjdCAmJiBnbG9iYWw7XG5cbi8qKiBEZXRlY3QgZnJlZSB2YXJpYWJsZSBgc2VsZmAuICovXG52YXIgZnJlZVNlbGYgPSB0eXBlb2Ygc2VsZiA9PSAnb2JqZWN0JyAmJiBzZWxmICYmIHNlbGYuT2JqZWN0ID09PSBPYmplY3QgJiYgc2VsZjtcblxuLyoqIFVzZWQgYXMgYSByZWZlcmVuY2UgdG8gdGhlIGdsb2JhbCBvYmplY3QuICovXG52YXIgcm9vdCA9IGZyZWVHbG9iYWwgfHwgZnJlZVNlbGYgfHwgRnVuY3Rpb24oJ3JldHVybiB0aGlzJykoKTtcblxuLyoqIERldGVjdCBmcmVlIHZhcmlhYmxlIGBleHBvcnRzYC4gKi9cbnZhciBmcmVlRXhwb3J0cyA9IHR5cGVvZiBleHBvcnRzID09ICdvYmplY3QnICYmIGV4cG9ydHMgJiYgIWV4cG9ydHMubm9kZVR5cGUgJiYgZXhwb3J0cztcblxuLyoqIERldGVjdCBmcmVlIHZhcmlhYmxlIGBtb2R1bGVgLiAqL1xudmFyIGZyZWVNb2R1bGUgPSBmcmVlRXhwb3J0cyAmJiB0eXBlb2YgbW9kdWxlID09ICdvYmplY3QnICYmIG1vZHVsZSAmJiAhbW9kdWxlLm5vZGVUeXBlICYmIG1vZHVsZTtcblxuLyoqIERldGVjdCB0aGUgcG9wdWxhciBDb21tb25KUyBleHRlbnNpb24gYG1vZHVsZS5leHBvcnRzYC4gKi9cbnZhciBtb2R1bGVFeHBvcnRzID0gZnJlZU1vZHVsZSAmJiBmcmVlTW9kdWxlLmV4cG9ydHMgPT09IGZyZWVFeHBvcnRzO1xuXG4vKipcbiAqIEFkZHMgdGhlIGtleS12YWx1ZSBgcGFpcmAgdG8gYG1hcGAuXG4gKlxuICogQHByaXZhdGVcbiAqIEBwYXJhbSB7T2JqZWN0fSBtYXAgVGhlIG1hcCB0byBtb2RpZnkuXG4gKiBAcGFyYW0ge0FycmF5fSBwYWlyIFRoZSBrZXktdmFsdWUgcGFpciB0byBhZGQuXG4gKiBAcmV0dXJucyB7T2JqZWN0fSBSZXR1cm5zIGBtYXBgLlxuICovXG5mdW5jdGlvbiBhZGRNYXBFbnRyeShtYXAsIHBhaXIpIHtcbiAgLy8gRG9uJ3QgcmV0dXJuIGBtYXAuc2V0YCBiZWNhdXNlIGl0J3Mgbm90IGNoYWluYWJsZSBpbiBJRSAxMS5cbiAgbWFwLnNldChwYWlyWzBdLCBwYWlyWzFdKTtcbiAgcmV0dXJuIG1hcDtcbn1cblxuLyoqXG4gKiBBZGRzIGB2YWx1ZWAgdG8gYHNldGAuXG4gKlxuICogQHByaXZhdGVcbiAqIEBwYXJhbSB7T2JqZWN0fSBzZXQgVGhlIHNldCB0byBtb2RpZnkuXG4gKiBAcGFyYW0geyp9IHZhbHVlIFRoZSB2YWx1ZSB0byBhZGQuXG4gKiBAcmV0dXJucyB7T2JqZWN0fSBSZXR1cm5zIGBzZXRgLlxuICovXG5mdW5jdGlvbiBhZGRTZXRFbnRyeShzZXQsIHZhbHVlKSB7XG4gIC8vIERvbid0IHJldHVybiBgc2V0LmFkZGAgYmVjYXVzZSBpdCdzIG5vdCBjaGFpbmFibGUgaW4gSUUgMTEuXG4gIHNldC5hZGQodmFsdWUpO1xuICByZXR1cm4gc2V0O1xufVxuXG4vKipcbiAqIEEgc3BlY2lhbGl6ZWQgdmVyc2lvbiBvZiBgXy5mb3JFYWNoYCBmb3IgYXJyYXlzIHdpdGhvdXQgc3VwcG9ydCBmb3JcbiAqIGl0ZXJhdGVlIHNob3J0aGFuZHMuXG4gKlxuICogQHByaXZhdGVcbiAqIEBwYXJhbSB7QXJyYXl9IFthcnJheV0gVGhlIGFycmF5IHRvIGl0ZXJhdGUgb3Zlci5cbiAqIEBwYXJhbSB7RnVuY3Rpb259IGl0ZXJhdGVlIFRoZSBmdW5jdGlvbiBpbnZva2VkIHBlciBpdGVyYXRpb24uXG4gKiBAcmV0dXJucyB7QXJyYXl9IFJldHVybnMgYGFycmF5YC5cbiAqL1xuZnVuY3Rpb24gYXJyYXlFYWNoKGFycmF5LCBpdGVyYXRlZSkge1xuICB2YXIgaW5kZXggPSAtMSxcbiAgICAgIGxlbmd0aCA9IGFycmF5ID8gYXJyYXkubGVuZ3RoIDogMDtcblxuICB3aGlsZSAoKytpbmRleCA8IGxlbmd0aCkge1xuICAgIGlmIChpdGVyYXRlZShhcnJheVtpbmRleF0sIGluZGV4LCBhcnJheSkgPT09IGZhbHNlKSB7XG4gICAgICBicmVhaztcbiAgICB9XG4gIH1cbiAgcmV0dXJuIGFycmF5O1xufVxuXG4vKipcbiAqIEFwcGVuZHMgdGhlIGVsZW1lbnRzIG9mIGB2YWx1ZXNgIHRvIGBhcnJheWAuXG4gKlxuICogQHByaXZhdGVcbiAqIEBwYXJhbSB7QXJyYXl9IGFycmF5IFRoZSBhcnJheSB0byBtb2RpZnkuXG4gKiBAcGFyYW0ge0FycmF5fSB2YWx1ZXMgVGhlIHZhbHVlcyB0byBhcHBlbmQuXG4gKiBAcmV0dXJucyB7QXJyYXl9IFJldHVybnMgYGFycmF5YC5cbiAqL1xuZnVuY3Rpb24gYXJyYXlQdXNoKGFycmF5LCB2YWx1ZXMpIHtcbiAgdmFyIGluZGV4ID0gLTEsXG4gICAgICBsZW5ndGggPSB2YWx1ZXMubGVuZ3RoLFxuICAgICAgb2Zmc2V0ID0gYXJyYXkubGVuZ3RoO1xuXG4gIHdoaWxlICgrK2luZGV4IDwgbGVuZ3RoKSB7XG4gICAgYXJyYXlbb2Zmc2V0ICsgaW5kZXhdID0gdmFsdWVzW2luZGV4XTtcbiAgfVxuICByZXR1cm4gYXJyYXk7XG59XG5cbi8qKlxuICogQSBzcGVjaWFsaXplZCB2ZXJzaW9uIG9mIGBfLnJlZHVjZWAgZm9yIGFycmF5cyB3aXRob3V0IHN1cHBvcnQgZm9yXG4gKiBpdGVyYXRlZSBzaG9ydGhhbmRzLlxuICpcbiAqIEBwcml2YXRlXG4gKiBAcGFyYW0ge0FycmF5fSBbYXJyYXldIFRoZSBhcnJheSB0byBpdGVyYXRlIG92ZXIuXG4gKiBAcGFyYW0ge0Z1bmN0aW9ufSBpdGVyYXRlZSBUaGUgZnVuY3Rpb24gaW52b2tlZCBwZXIgaXRlcmF0aW9uLlxuICogQHBhcmFtIHsqfSBbYWNjdW11bGF0b3JdIFRoZSBpbml0aWFsIHZhbHVlLlxuICogQHBhcmFtIHtib29sZWFufSBbaW5pdEFjY3VtXSBTcGVjaWZ5IHVzaW5nIHRoZSBmaXJzdCBlbGVtZW50IG9mIGBhcnJheWAgYXNcbiAqICB0aGUgaW5pdGlhbCB2YWx1ZS5cbiAqIEByZXR1cm5zIHsqfSBSZXR1cm5zIHRoZSBhY2N1bXVsYXRlZCB2YWx1ZS5cbiAqL1xuZnVuY3Rpb24gYXJyYXlSZWR1Y2UoYXJyYXksIGl0ZXJhdGVlLCBhY2N1bXVsYXRvciwgaW5pdEFjY3VtKSB7XG4gIHZhciBpbmRleCA9IC0xLFxuICAgICAgbGVuZ3RoID0gYXJyYXkgPyBhcnJheS5sZW5ndGggOiAwO1xuXG4gIGlmIChpbml0QWNjdW0gJiYgbGVuZ3RoKSB7XG4gICAgYWNjdW11bGF0b3IgPSBhcnJheVsrK2luZGV4XTtcbiAgfVxuICB3aGlsZSAoKytpbmRleCA8IGxlbmd0aCkge1xuICAgIGFjY3VtdWxhdG9yID0gaXRlcmF0ZWUoYWNjdW11bGF0b3IsIGFycmF5W2luZGV4XSwgaW5kZXgsIGFycmF5KTtcbiAgfVxuICByZXR1cm4gYWNjdW11bGF0b3I7XG59XG5cbi8qKlxuICogVGhlIGJhc2UgaW1wbGVtZW50YXRpb24gb2YgYF8udGltZXNgIHdpdGhvdXQgc3VwcG9ydCBmb3IgaXRlcmF0ZWUgc2hvcnRoYW5kc1xuICogb3IgbWF4IGFycmF5IGxlbmd0aCBjaGVja3MuXG4gKlxuICogQHByaXZhdGVcbiAqIEBwYXJhbSB7bnVtYmVyfSBuIFRoZSBudW1iZXIgb2YgdGltZXMgdG8gaW52b2tlIGBpdGVyYXRlZWAuXG4gKiBAcGFyYW0ge0Z1bmN0aW9ufSBpdGVyYXRlZSBUaGUgZnVuY3Rpb24gaW52b2tlZCBwZXIgaXRlcmF0aW9uLlxuICogQHJldHVybnMge0FycmF5fSBSZXR1cm5zIHRoZSBhcnJheSBvZiByZXN1bHRzLlxuICovXG5mdW5jdGlvbiBiYXNlVGltZXMobiwgaXRlcmF0ZWUpIHtcbiAgdmFyIGluZGV4ID0gLTEsXG4gICAgICByZXN1bHQgPSBBcnJheShuKTtcblxuICB3aGlsZSAoKytpbmRleCA8IG4pIHtcbiAgICByZXN1bHRbaW5kZXhdID0gaXRlcmF0ZWUoaW5kZXgpO1xuICB9XG4gIHJldHVybiByZXN1bHQ7XG59XG5cbi8qKlxuICogR2V0cyB0aGUgdmFsdWUgYXQgYGtleWAgb2YgYG9iamVjdGAuXG4gKlxuICogQHByaXZhdGVcbiAqIEBwYXJhbSB7T2JqZWN0fSBbb2JqZWN0XSBUaGUgb2JqZWN0IHRvIHF1ZXJ5LlxuICogQHBhcmFtIHtzdHJpbmd9IGtleSBUaGUga2V5IG9mIHRoZSBwcm9wZXJ0eSB0byBnZXQuXG4gKiBAcmV0dXJucyB7Kn0gUmV0dXJucyB0aGUgcHJvcGVydHkgdmFsdWUuXG4gKi9cbmZ1bmN0aW9uIGdldFZhbHVlKG9iamVjdCwga2V5KSB7XG4gIHJldHVybiBvYmplY3QgPT0gbnVsbCA/IHVuZGVmaW5lZCA6IG9iamVjdFtrZXldO1xufVxuXG4vKipcbiAqIENoZWNrcyBpZiBgdmFsdWVgIGlzIGEgaG9zdCBvYmplY3QgaW4gSUUgPCA5LlxuICpcbiAqIEBwcml2YXRlXG4gKiBAcGFyYW0geyp9IHZhbHVlIFRoZSB2YWx1ZSB0byBjaGVjay5cbiAqIEByZXR1cm5zIHtib29sZWFufSBSZXR1cm5zIGB0cnVlYCBpZiBgdmFsdWVgIGlzIGEgaG9zdCBvYmplY3QsIGVsc2UgYGZhbHNlYC5cbiAqL1xuZnVuY3Rpb24gaXNIb3N0T2JqZWN0KHZhbHVlKSB7XG4gIC8vIE1hbnkgaG9zdCBvYmplY3RzIGFyZSBgT2JqZWN0YCBvYmplY3RzIHRoYXQgY2FuIGNvZXJjZSB0byBzdHJpbmdzXG4gIC8vIGRlc3BpdGUgaGF2aW5nIGltcHJvcGVybHkgZGVmaW5lZCBgdG9TdHJpbmdgIG1ldGhvZHMuXG4gIHZhciByZXN1bHQgPSBmYWxzZTtcbiAgaWYgKHZhbHVlICE9IG51bGwgJiYgdHlwZW9mIHZhbHVlLnRvU3RyaW5nICE9ICdmdW5jdGlvbicpIHtcbiAgICB0cnkge1xuICAgICAgcmVzdWx0ID0gISEodmFsdWUgKyAnJyk7XG4gICAgfSBjYXRjaCAoZSkge31cbiAgfVxuICByZXR1cm4gcmVzdWx0O1xufVxuXG4vKipcbiAqIENvbnZlcnRzIGBtYXBgIHRvIGl0cyBrZXktdmFsdWUgcGFpcnMuXG4gKlxuICogQHByaXZhdGVcbiAqIEBwYXJhbSB7T2JqZWN0fSBtYXAgVGhlIG1hcCB0byBjb252ZXJ0LlxuICogQHJldHVybnMge0FycmF5fSBSZXR1cm5zIHRoZSBrZXktdmFsdWUgcGFpcnMuXG4gKi9cbmZ1bmN0aW9uIG1hcFRvQXJyYXkobWFwKSB7XG4gIHZhciBpbmRleCA9IC0xLFxuICAgICAgcmVzdWx0ID0gQXJyYXkobWFwLnNpemUpO1xuXG4gIG1hcC5mb3JFYWNoKGZ1bmN0aW9uKHZhbHVlLCBrZXkpIHtcbiAgICByZXN1bHRbKytpbmRleF0gPSBba2V5LCB2YWx1ZV07XG4gIH0pO1xuICByZXR1cm4gcmVzdWx0O1xufVxuXG4vKipcbiAqIENyZWF0ZXMgYSB1bmFyeSBmdW5jdGlvbiB0aGF0IGludm9rZXMgYGZ1bmNgIHdpdGggaXRzIGFyZ3VtZW50IHRyYW5zZm9ybWVkLlxuICpcbiAqIEBwcml2YXRlXG4gKiBAcGFyYW0ge0Z1bmN0aW9ufSBmdW5jIFRoZSBmdW5jdGlvbiB0byB3cmFwLlxuICogQHBhcmFtIHtGdW5jdGlvbn0gdHJhbnNmb3JtIFRoZSBhcmd1bWVudCB0cmFuc2Zvcm0uXG4gKiBAcmV0dXJucyB7RnVuY3Rpb259IFJldHVybnMgdGhlIG5ldyBmdW5jdGlvbi5cbiAqL1xuZnVuY3Rpb24gb3ZlckFyZyhmdW5jLCB0cmFuc2Zvcm0pIHtcbiAgcmV0dXJuIGZ1bmN0aW9uKGFyZykge1xuICAgIHJldHVybiBmdW5jKHRyYW5zZm9ybShhcmcpKTtcbiAgfTtcbn1cblxuLyoqXG4gKiBDb252ZXJ0cyBgc2V0YCB0byBhbiBhcnJheSBvZiBpdHMgdmFsdWVzLlxuICpcbiAqIEBwcml2YXRlXG4gKiBAcGFyYW0ge09iamVjdH0gc2V0IFRoZSBzZXQgdG8gY29udmVydC5cbiAqIEByZXR1cm5zIHtBcnJheX0gUmV0dXJucyB0aGUgdmFsdWVzLlxuICovXG5mdW5jdGlvbiBzZXRUb0FycmF5KHNldCkge1xuICB2YXIgaW5kZXggPSAtMSxcbiAgICAgIHJlc3VsdCA9IEFycmF5KHNldC5zaXplKTtcblxuICBzZXQuZm9yRWFjaChmdW5jdGlvbih2YWx1ZSkge1xuICAgIHJlc3VsdFsrK2luZGV4XSA9IHZhbHVlO1xuICB9KTtcbiAgcmV0dXJuIHJlc3VsdDtcbn1cblxuLyoqIFVzZWQgZm9yIGJ1aWx0LWluIG1ldGhvZCByZWZlcmVuY2VzLiAqL1xudmFyIGFycmF5UHJvdG8gPSBBcnJheS5wcm90b3R5cGUsXG4gICAgZnVuY1Byb3RvID0gRnVuY3Rpb24ucHJvdG90eXBlLFxuICAgIG9iamVjdFByb3RvID0gT2JqZWN0LnByb3RvdHlwZTtcblxuLyoqIFVzZWQgdG8gZGV0ZWN0IG92ZXJyZWFjaGluZyBjb3JlLWpzIHNoaW1zLiAqL1xudmFyIGNvcmVKc0RhdGEgPSByb290WydfX2NvcmUtanNfc2hhcmVkX18nXTtcblxuLyoqIFVzZWQgdG8gZGV0ZWN0IG1ldGhvZHMgbWFzcXVlcmFkaW5nIGFzIG5hdGl2ZS4gKi9cbnZhciBtYXNrU3JjS2V5ID0gKGZ1bmN0aW9uKCkge1xuICB2YXIgdWlkID0gL1teLl0rJC8uZXhlYyhjb3JlSnNEYXRhICYmIGNvcmVKc0RhdGEua2V5cyAmJiBjb3JlSnNEYXRhLmtleXMuSUVfUFJPVE8gfHwgJycpO1xuICByZXR1cm4gdWlkID8gKCdTeW1ib2woc3JjKV8xLicgKyB1aWQpIDogJyc7XG59KCkpO1xuXG4vKiogVXNlZCB0byByZXNvbHZlIHRoZSBkZWNvbXBpbGVkIHNvdXJjZSBvZiBmdW5jdGlvbnMuICovXG52YXIgZnVuY1RvU3RyaW5nID0gZnVuY1Byb3RvLnRvU3RyaW5nO1xuXG4vKiogVXNlZCB0byBjaGVjayBvYmplY3RzIGZvciBvd24gcHJvcGVydGllcy4gKi9cbnZhciBoYXNPd25Qcm9wZXJ0eSA9IG9iamVjdFByb3RvLmhhc093blByb3BlcnR5O1xuXG4vKipcbiAqIFVzZWQgdG8gcmVzb2x2ZSB0aGVcbiAqIFtgdG9TdHJpbmdUYWdgXShodHRwOi8vZWNtYS1pbnRlcm5hdGlvbmFsLm9yZy9lY21hLTI2Mi83LjAvI3NlYy1vYmplY3QucHJvdG90eXBlLnRvc3RyaW5nKVxuICogb2YgdmFsdWVzLlxuICovXG52YXIgb2JqZWN0VG9TdHJpbmcgPSBvYmplY3RQcm90by50b1N0cmluZztcblxuLyoqIFVzZWQgdG8gZGV0ZWN0IGlmIGEgbWV0aG9kIGlzIG5hdGl2ZS4gKi9cbnZhciByZUlzTmF0aXZlID0gUmVnRXhwKCdeJyArXG4gIGZ1bmNUb1N0cmluZy5jYWxsKGhhc093blByb3BlcnR5KS5yZXBsYWNlKHJlUmVnRXhwQ2hhciwgJ1xcXFwkJicpXG4gIC5yZXBsYWNlKC9oYXNPd25Qcm9wZXJ0eXwoZnVuY3Rpb24pLio/KD89XFxcXFxcKCl8IGZvciAuKz8oPz1cXFxcXFxdKS9nLCAnJDEuKj8nKSArICckJ1xuKTtcblxuLyoqIEJ1aWx0LWluIHZhbHVlIHJlZmVyZW5jZXMuICovXG52YXIgQnVmZmVyID0gbW9kdWxlRXhwb3J0cyA/IHJvb3QuQnVmZmVyIDogdW5kZWZpbmVkLFxuICAgIFN5bWJvbCA9IHJvb3QuU3ltYm9sLFxuICAgIFVpbnQ4QXJyYXkgPSByb290LlVpbnQ4QXJyYXksXG4gICAgZ2V0UHJvdG90eXBlID0gb3ZlckFyZyhPYmplY3QuZ2V0UHJvdG90eXBlT2YsIE9iamVjdCksXG4gICAgb2JqZWN0Q3JlYXRlID0gT2JqZWN0LmNyZWF0ZSxcbiAgICBwcm9wZXJ0eUlzRW51bWVyYWJsZSA9IG9iamVjdFByb3RvLnByb3BlcnR5SXNFbnVtZXJhYmxlLFxuICAgIHNwbGljZSA9IGFycmF5UHJvdG8uc3BsaWNlO1xuXG4vKiBCdWlsdC1pbiBtZXRob2QgcmVmZXJlbmNlcyBmb3IgdGhvc2Ugd2l0aCB0aGUgc2FtZSBuYW1lIGFzIG90aGVyIGBsb2Rhc2hgIG1ldGhvZHMuICovXG52YXIgbmF0aXZlR2V0U3ltYm9scyA9IE9iamVjdC5nZXRPd25Qcm9wZXJ0eVN5bWJvbHMsXG4gICAgbmF0aXZlSXNCdWZmZXIgPSBCdWZmZXIgPyBCdWZmZXIuaXNCdWZmZXIgOiB1bmRlZmluZWQsXG4gICAgbmF0aXZlS2V5cyA9IG92ZXJBcmcoT2JqZWN0LmtleXMsIE9iamVjdCk7XG5cbi8qIEJ1aWx0LWluIG1ldGhvZCByZWZlcmVuY2VzIHRoYXQgYXJlIHZlcmlmaWVkIHRvIGJlIG5hdGl2ZS4gKi9cbnZhciBEYXRhVmlldyA9IGdldE5hdGl2ZShyb290LCAnRGF0YVZpZXcnKSxcbiAgICBNYXAgPSBnZXROYXRpdmUocm9vdCwgJ01hcCcpLFxuICAgIFByb21pc2UgPSBnZXROYXRpdmUocm9vdCwgJ1Byb21pc2UnKSxcbiAgICBTZXQgPSBnZXROYXRpdmUocm9vdCwgJ1NldCcpLFxuICAgIFdlYWtNYXAgPSBnZXROYXRpdmUocm9vdCwgJ1dlYWtNYXAnKSxcbiAgICBuYXRpdmVDcmVhdGUgPSBnZXROYXRpdmUoT2JqZWN0LCAnY3JlYXRlJyk7XG5cbi8qKiBVc2VkIHRvIGRldGVjdCBtYXBzLCBzZXRzLCBhbmQgd2Vha21hcHMuICovXG52YXIgZGF0YVZpZXdDdG9yU3RyaW5nID0gdG9Tb3VyY2UoRGF0YVZpZXcpLFxuICAgIG1hcEN0b3JTdHJpbmcgPSB0b1NvdXJjZShNYXApLFxuICAgIHByb21pc2VDdG9yU3RyaW5nID0gdG9Tb3VyY2UoUHJvbWlzZSksXG4gICAgc2V0Q3RvclN0cmluZyA9IHRvU291cmNlKFNldCksXG4gICAgd2Vha01hcEN0b3JTdHJpbmcgPSB0b1NvdXJjZShXZWFrTWFwKTtcblxuLyoqIFVzZWQgdG8gY29udmVydCBzeW1ib2xzIHRvIHByaW1pdGl2ZXMgYW5kIHN0cmluZ3MuICovXG52YXIgc3ltYm9sUHJvdG8gPSBTeW1ib2wgPyBTeW1ib2wucHJvdG90eXBlIDogdW5kZWZpbmVkLFxuICAgIHN5bWJvbFZhbHVlT2YgPSBzeW1ib2xQcm90byA/IHN5bWJvbFByb3RvLnZhbHVlT2YgOiB1bmRlZmluZWQ7XG5cbi8qKlxuICogQ3JlYXRlcyBhIGhhc2ggb2JqZWN0LlxuICpcbiAqIEBwcml2YXRlXG4gKiBAY29uc3RydWN0b3JcbiAqIEBwYXJhbSB7QXJyYXl9IFtlbnRyaWVzXSBUaGUga2V5LXZhbHVlIHBhaXJzIHRvIGNhY2hlLlxuICovXG5mdW5jdGlvbiBIYXNoKGVudHJpZXMpIHtcbiAgdmFyIGluZGV4ID0gLTEsXG4gICAgICBsZW5ndGggPSBlbnRyaWVzID8gZW50cmllcy5sZW5ndGggOiAwO1xuXG4gIHRoaXMuY2xlYXIoKTtcbiAgd2hpbGUgKCsraW5kZXggPCBsZW5ndGgpIHtcbiAgICB2YXIgZW50cnkgPSBlbnRyaWVzW2luZGV4XTtcbiAgICB0aGlzLnNldChlbnRyeVswXSwgZW50cnlbMV0pO1xuICB9XG59XG5cbi8qKlxuICogUmVtb3ZlcyBhbGwga2V5LXZhbHVlIGVudHJpZXMgZnJvbSB0aGUgaGFzaC5cbiAqXG4gKiBAcHJpdmF0ZVxuICogQG5hbWUgY2xlYXJcbiAqIEBtZW1iZXJPZiBIYXNoXG4gKi9cbmZ1bmN0aW9uIGhhc2hDbGVhcigpIHtcbiAgdGhpcy5fX2RhdGFfXyA9IG5hdGl2ZUNyZWF0ZSA/IG5hdGl2ZUNyZWF0ZShudWxsKSA6IHt9O1xufVxuXG4vKipcbiAqIFJlbW92ZXMgYGtleWAgYW5kIGl0cyB2YWx1ZSBmcm9tIHRoZSBoYXNoLlxuICpcbiAqIEBwcml2YXRlXG4gKiBAbmFtZSBkZWxldGVcbiAqIEBtZW1iZXJPZiBIYXNoXG4gKiBAcGFyYW0ge09iamVjdH0gaGFzaCBUaGUgaGFzaCB0byBtb2RpZnkuXG4gKiBAcGFyYW0ge3N0cmluZ30ga2V5IFRoZSBrZXkgb2YgdGhlIHZhbHVlIHRvIHJlbW92ZS5cbiAqIEByZXR1cm5zIHtib29sZWFufSBSZXR1cm5zIGB0cnVlYCBpZiB0aGUgZW50cnkgd2FzIHJlbW92ZWQsIGVsc2UgYGZhbHNlYC5cbiAqL1xuZnVuY3Rpb24gaGFzaERlbGV0ZShrZXkpIHtcbiAgcmV0dXJuIHRoaXMuaGFzKGtleSkgJiYgZGVsZXRlIHRoaXMuX19kYXRhX19ba2V5XTtcbn1cblxuLyoqXG4gKiBHZXRzIHRoZSBoYXNoIHZhbHVlIGZvciBga2V5YC5cbiAqXG4gKiBAcHJpdmF0ZVxuICogQG5hbWUgZ2V0XG4gKiBAbWVtYmVyT2YgSGFzaFxuICogQHBhcmFtIHtzdHJpbmd9IGtleSBUaGUga2V5IG9mIHRoZSB2YWx1ZSB0byBnZXQuXG4gKiBAcmV0dXJucyB7Kn0gUmV0dXJucyB0aGUgZW50cnkgdmFsdWUuXG4gKi9cbmZ1bmN0aW9uIGhhc2hHZXQoa2V5KSB7XG4gIHZhciBkYXRhID0gdGhpcy5fX2RhdGFfXztcbiAgaWYgKG5hdGl2ZUNyZWF0ZSkge1xuICAgIHZhciByZXN1bHQgPSBkYXRhW2tleV07XG4gICAgcmV0dXJuIHJlc3VsdCA9PT0gSEFTSF9VTkRFRklORUQgPyB1bmRlZmluZWQgOiByZXN1bHQ7XG4gIH1cbiAgcmV0dXJuIGhhc093blByb3BlcnR5LmNhbGwoZGF0YSwga2V5KSA/IGRhdGFba2V5XSA6IHVuZGVmaW5lZDtcbn1cblxuLyoqXG4gKiBDaGVja3MgaWYgYSBoYXNoIHZhbHVlIGZvciBga2V5YCBleGlzdHMuXG4gKlxuICogQHByaXZhdGVcbiAqIEBuYW1lIGhhc1xuICogQG1lbWJlck9mIEhhc2hcbiAqIEBwYXJhbSB7c3RyaW5nfSBrZXkgVGhlIGtleSBvZiB0aGUgZW50cnkgdG8gY2hlY2suXG4gKiBAcmV0dXJucyB7Ym9vbGVhbn0gUmV0dXJucyBgdHJ1ZWAgaWYgYW4gZW50cnkgZm9yIGBrZXlgIGV4aXN0cywgZWxzZSBgZmFsc2VgLlxuICovXG5mdW5jdGlvbiBoYXNoSGFzKGtleSkge1xuICB2YXIgZGF0YSA9IHRoaXMuX19kYXRhX187XG4gIHJldHVybiBuYXRpdmVDcmVhdGUgPyBkYXRhW2tleV0gIT09IHVuZGVmaW5lZCA6IGhhc093blByb3BlcnR5LmNhbGwoZGF0YSwga2V5KTtcbn1cblxuLyoqXG4gKiBTZXRzIHRoZSBoYXNoIGBrZXlgIHRvIGB2YWx1ZWAuXG4gKlxuICogQHByaXZhdGVcbiAqIEBuYW1lIHNldFxuICogQG1lbWJlck9mIEhhc2hcbiAqIEBwYXJhbSB7c3RyaW5nfSBrZXkgVGhlIGtleSBvZiB0aGUgdmFsdWUgdG8gc2V0LlxuICogQHBhcmFtIHsqfSB2YWx1ZSBUaGUgdmFsdWUgdG8gc2V0LlxuICogQHJldHVybnMge09iamVjdH0gUmV0dXJucyB0aGUgaGFzaCBpbnN0YW5jZS5cbiAqL1xuZnVuY3Rpb24gaGFzaFNldChrZXksIHZhbHVlKSB7XG4gIHZhciBkYXRhID0gdGhpcy5fX2RhdGFfXztcbiAgZGF0YVtrZXldID0gKG5hdGl2ZUNyZWF0ZSAmJiB2YWx1ZSA9PT0gdW5kZWZpbmVkKSA/IEhBU0hfVU5ERUZJTkVEIDogdmFsdWU7XG4gIHJldHVybiB0aGlzO1xufVxuXG4vLyBBZGQgbWV0aG9kcyB0byBgSGFzaGAuXG5IYXNoLnByb3RvdHlwZS5jbGVhciA9IGhhc2hDbGVhcjtcbkhhc2gucHJvdG90eXBlWydkZWxldGUnXSA9IGhhc2hEZWxldGU7XG5IYXNoLnByb3RvdHlwZS5nZXQgPSBoYXNoR2V0O1xuSGFzaC5wcm90b3R5cGUuaGFzID0gaGFzaEhhcztcbkhhc2gucHJvdG90eXBlLnNldCA9IGhhc2hTZXQ7XG5cbi8qKlxuICogQ3JlYXRlcyBhbiBsaXN0IGNhY2hlIG9iamVjdC5cbiAqXG4gKiBAcHJpdmF0ZVxuICogQGNvbnN0cnVjdG9yXG4gKiBAcGFyYW0ge0FycmF5fSBbZW50cmllc10gVGhlIGtleS12YWx1ZSBwYWlycyB0byBjYWNoZS5cbiAqL1xuZnVuY3Rpb24gTGlzdENhY2hlKGVudHJpZXMpIHtcbiAgdmFyIGluZGV4ID0gLTEsXG4gICAgICBsZW5ndGggPSBlbnRyaWVzID8gZW50cmllcy5sZW5ndGggOiAwO1xuXG4gIHRoaXMuY2xlYXIoKTtcbiAgd2hpbGUgKCsraW5kZXggPCBsZW5ndGgpIHtcbiAgICB2YXIgZW50cnkgPSBlbnRyaWVzW2luZGV4XTtcbiAgICB0aGlzLnNldChlbnRyeVswXSwgZW50cnlbMV0pO1xuICB9XG59XG5cbi8qKlxuICogUmVtb3ZlcyBhbGwga2V5LXZhbHVlIGVudHJpZXMgZnJvbSB0aGUgbGlzdCBjYWNoZS5cbiAqXG4gKiBAcHJpdmF0ZVxuICogQG5hbWUgY2xlYXJcbiAqIEBtZW1iZXJPZiBMaXN0Q2FjaGVcbiAqL1xuZnVuY3Rpb24gbGlzdENhY2hlQ2xlYXIoKSB7XG4gIHRoaXMuX19kYXRhX18gPSBbXTtcbn1cblxuLyoqXG4gKiBSZW1vdmVzIGBrZXlgIGFuZCBpdHMgdmFsdWUgZnJvbSB0aGUgbGlzdCBjYWNoZS5cbiAqXG4gKiBAcHJpdmF0ZVxuICogQG5hbWUgZGVsZXRlXG4gKiBAbWVtYmVyT2YgTGlzdENhY2hlXG4gKiBAcGFyYW0ge3N0cmluZ30ga2V5IFRoZSBrZXkgb2YgdGhlIHZhbHVlIHRvIHJlbW92ZS5cbiAqIEByZXR1cm5zIHtib29sZWFufSBSZXR1cm5zIGB0cnVlYCBpZiB0aGUgZW50cnkgd2FzIHJlbW92ZWQsIGVsc2UgYGZhbHNlYC5cbiAqL1xuZnVuY3Rpb24gbGlzdENhY2hlRGVsZXRlKGtleSkge1xuICB2YXIgZGF0YSA9IHRoaXMuX19kYXRhX18sXG4gICAgICBpbmRleCA9IGFzc29jSW5kZXhPZihkYXRhLCBrZXkpO1xuXG4gIGlmIChpbmRleCA8IDApIHtcbiAgICByZXR1cm4gZmFsc2U7XG4gIH1cbiAgdmFyIGxhc3RJbmRleCA9IGRhdGEubGVuZ3RoIC0gMTtcbiAgaWYgKGluZGV4ID09IGxhc3RJbmRleCkge1xuICAgIGRhdGEucG9wKCk7XG4gIH0gZWxzZSB7XG4gICAgc3BsaWNlLmNhbGwoZGF0YSwgaW5kZXgsIDEpO1xuICB9XG4gIHJldHVybiB0cnVlO1xufVxuXG4vKipcbiAqIEdldHMgdGhlIGxpc3QgY2FjaGUgdmFsdWUgZm9yIGBrZXlgLlxuICpcbiAqIEBwcml2YXRlXG4gKiBAbmFtZSBnZXRcbiAqIEBtZW1iZXJPZiBMaXN0Q2FjaGVcbiAqIEBwYXJhbSB7c3RyaW5nfSBrZXkgVGhlIGtleSBvZiB0aGUgdmFsdWUgdG8gZ2V0LlxuICogQHJldHVybnMgeyp9IFJldHVybnMgdGhlIGVudHJ5IHZhbHVlLlxuICovXG5mdW5jdGlvbiBsaXN0Q2FjaGVHZXQoa2V5KSB7XG4gIHZhciBkYXRhID0gdGhpcy5fX2RhdGFfXyxcbiAgICAgIGluZGV4ID0gYXNzb2NJbmRleE9mKGRhdGEsIGtleSk7XG5cbiAgcmV0dXJuIGluZGV4IDwgMCA/IHVuZGVmaW5lZCA6IGRhdGFbaW5kZXhdWzFdO1xufVxuXG4vKipcbiAqIENoZWNrcyBpZiBhIGxpc3QgY2FjaGUgdmFsdWUgZm9yIGBrZXlgIGV4aXN0cy5cbiAqXG4gKiBAcHJpdmF0ZVxuICogQG5hbWUgaGFzXG4gKiBAbWVtYmVyT2YgTGlzdENhY2hlXG4gKiBAcGFyYW0ge3N0cmluZ30ga2V5IFRoZSBrZXkgb2YgdGhlIGVudHJ5IHRvIGNoZWNrLlxuICogQHJldHVybnMge2Jvb2xlYW59IFJldHVybnMgYHRydWVgIGlmIGFuIGVudHJ5IGZvciBga2V5YCBleGlzdHMsIGVsc2UgYGZhbHNlYC5cbiAqL1xuZnVuY3Rpb24gbGlzdENhY2hlSGFzKGtleSkge1xuICByZXR1cm4gYXNzb2NJbmRleE9mKHRoaXMuX19kYXRhX18sIGtleSkgPiAtMTtcbn1cblxuLyoqXG4gKiBTZXRzIHRoZSBsaXN0IGNhY2hlIGBrZXlgIHRvIGB2YWx1ZWAuXG4gKlxuICogQHByaXZhdGVcbiAqIEBuYW1lIHNldFxuICogQG1lbWJlck9mIExpc3RDYWNoZVxuICogQHBhcmFtIHtzdHJpbmd9IGtleSBUaGUga2V5IG9mIHRoZSB2YWx1ZSB0byBzZXQuXG4gKiBAcGFyYW0geyp9IHZhbHVlIFRoZSB2YWx1ZSB0byBzZXQuXG4gKiBAcmV0dXJucyB7T2JqZWN0fSBSZXR1cm5zIHRoZSBsaXN0IGNhY2hlIGluc3RhbmNlLlxuICovXG5mdW5jdGlvbiBsaXN0Q2FjaGVTZXQoa2V5LCB2YWx1ZSkge1xuICB2YXIgZGF0YSA9IHRoaXMuX19kYXRhX18sXG4gICAgICBpbmRleCA9IGFzc29jSW5kZXhPZihkYXRhLCBrZXkpO1xuXG4gIGlmIChpbmRleCA8IDApIHtcbiAgICBkYXRhLnB1c2goW2tleSwgdmFsdWVdKTtcbiAgfSBlbHNlIHtcbiAgICBkYXRhW2luZGV4XVsxXSA9IHZhbHVlO1xuICB9XG4gIHJldHVybiB0aGlzO1xufVxuXG4vLyBBZGQgbWV0aG9kcyB0byBgTGlzdENhY2hlYC5cbkxpc3RDYWNoZS5wcm90b3R5cGUuY2xlYXIgPSBsaXN0Q2FjaGVDbGVhcjtcbkxpc3RDYWNoZS5wcm90b3R5cGVbJ2RlbGV0ZSddID0gbGlzdENhY2hlRGVsZXRlO1xuTGlzdENhY2hlLnByb3RvdHlwZS5nZXQgPSBsaXN0Q2FjaGVHZXQ7XG5MaXN0Q2FjaGUucHJvdG90eXBlLmhhcyA9IGxpc3RDYWNoZUhhcztcbkxpc3RDYWNoZS5wcm90b3R5cGUuc2V0ID0gbGlzdENhY2hlU2V0O1xuXG4vKipcbiAqIENyZWF0ZXMgYSBtYXAgY2FjaGUgb2JqZWN0IHRvIHN0b3JlIGtleS12YWx1ZSBwYWlycy5cbiAqXG4gKiBAcHJpdmF0ZVxuICogQGNvbnN0cnVjdG9yXG4gKiBAcGFyYW0ge0FycmF5fSBbZW50cmllc10gVGhlIGtleS12YWx1ZSBwYWlycyB0byBjYWNoZS5cbiAqL1xuZnVuY3Rpb24gTWFwQ2FjaGUoZW50cmllcykge1xuICB2YXIgaW5kZXggPSAtMSxcbiAgICAgIGxlbmd0aCA9IGVudHJpZXMgPyBlbnRyaWVzLmxlbmd0aCA6IDA7XG5cbiAgdGhpcy5jbGVhcigpO1xuICB3aGlsZSAoKytpbmRleCA8IGxlbmd0aCkge1xuICAgIHZhciBlbnRyeSA9IGVudHJpZXNbaW5kZXhdO1xuICAgIHRoaXMuc2V0KGVudHJ5WzBdLCBlbnRyeVsxXSk7XG4gIH1cbn1cblxuLyoqXG4gKiBSZW1vdmVzIGFsbCBrZXktdmFsdWUgZW50cmllcyBmcm9tIHRoZSBtYXAuXG4gKlxuICogQHByaXZhdGVcbiAqIEBuYW1lIGNsZWFyXG4gKiBAbWVtYmVyT2YgTWFwQ2FjaGVcbiAqL1xuZnVuY3Rpb24gbWFwQ2FjaGVDbGVhcigpIHtcbiAgdGhpcy5fX2RhdGFfXyA9IHtcbiAgICAnaGFzaCc6IG5ldyBIYXNoLFxuICAgICdtYXAnOiBuZXcgKE1hcCB8fCBMaXN0Q2FjaGUpLFxuICAgICdzdHJpbmcnOiBuZXcgSGFzaFxuICB9O1xufVxuXG4vKipcbiAqIFJlbW92ZXMgYGtleWAgYW5kIGl0cyB2YWx1ZSBmcm9tIHRoZSBtYXAuXG4gKlxuICogQHByaXZhdGVcbiAqIEBuYW1lIGRlbGV0ZVxuICogQG1lbWJlck9mIE1hcENhY2hlXG4gKiBAcGFyYW0ge3N0cmluZ30ga2V5IFRoZSBrZXkgb2YgdGhlIHZhbHVlIHRvIHJlbW92ZS5cbiAqIEByZXR1cm5zIHtib29sZWFufSBSZXR1cm5zIGB0cnVlYCBpZiB0aGUgZW50cnkgd2FzIHJlbW92ZWQsIGVsc2UgYGZhbHNlYC5cbiAqL1xuZnVuY3Rpb24gbWFwQ2FjaGVEZWxldGUoa2V5KSB7XG4gIHJldHVybiBnZXRNYXBEYXRhKHRoaXMsIGtleSlbJ2RlbGV0ZSddKGtleSk7XG59XG5cbi8qKlxuICogR2V0cyB0aGUgbWFwIHZhbHVlIGZvciBga2V5YC5cbiAqXG4gKiBAcHJpdmF0ZVxuICogQG5hbWUgZ2V0XG4gKiBAbWVtYmVyT2YgTWFwQ2FjaGVcbiAqIEBwYXJhbSB7c3RyaW5nfSBrZXkgVGhlIGtleSBvZiB0aGUgdmFsdWUgdG8gZ2V0LlxuICogQHJldHVybnMgeyp9IFJldHVybnMgdGhlIGVudHJ5IHZhbHVlLlxuICovXG5mdW5jdGlvbiBtYXBDYWNoZUdldChrZXkpIHtcbiAgcmV0dXJuIGdldE1hcERhdGEodGhpcywga2V5KS5nZXQoa2V5KTtcbn1cblxuLyoqXG4gKiBDaGVja3MgaWYgYSBtYXAgdmFsdWUgZm9yIGBrZXlgIGV4aXN0cy5cbiAqXG4gKiBAcHJpdmF0ZVxuICogQG5hbWUgaGFzXG4gKiBAbWVtYmVyT2YgTWFwQ2FjaGVcbiAqIEBwYXJhbSB7c3RyaW5nfSBrZXkgVGhlIGtleSBvZiB0aGUgZW50cnkgdG8gY2hlY2suXG4gKiBAcmV0dXJucyB7Ym9vbGVhbn0gUmV0dXJucyBgdHJ1ZWAgaWYgYW4gZW50cnkgZm9yIGBrZXlgIGV4aXN0cywgZWxzZSBgZmFsc2VgLlxuICovXG5mdW5jdGlvbiBtYXBDYWNoZUhhcyhrZXkpIHtcbiAgcmV0dXJuIGdldE1hcERhdGEodGhpcywga2V5KS5oYXMoa2V5KTtcbn1cblxuLyoqXG4gKiBTZXRzIHRoZSBtYXAgYGtleWAgdG8gYHZhbHVlYC5cbiAqXG4gKiBAcHJpdmF0ZVxuICogQG5hbWUgc2V0XG4gKiBAbWVtYmVyT2YgTWFwQ2FjaGVcbiAqIEBwYXJhbSB7c3RyaW5nfSBrZXkgVGhlIGtleSBvZiB0aGUgdmFsdWUgdG8gc2V0LlxuICogQHBhcmFtIHsqfSB2YWx1ZSBUaGUgdmFsdWUgdG8gc2V0LlxuICogQHJldHVybnMge09iamVjdH0gUmV0dXJucyB0aGUgbWFwIGNhY2hlIGluc3RhbmNlLlxuICovXG5mdW5jdGlvbiBtYXBDYWNoZVNldChrZXksIHZhbHVlKSB7XG4gIGdldE1hcERhdGEodGhpcywga2V5KS5zZXQoa2V5LCB2YWx1ZSk7XG4gIHJldHVybiB0aGlzO1xufVxuXG4vLyBBZGQgbWV0aG9kcyB0byBgTWFwQ2FjaGVgLlxuTWFwQ2FjaGUucHJvdG90eXBlLmNsZWFyID0gbWFwQ2FjaGVDbGVhcjtcbk1hcENhY2hlLnByb3RvdHlwZVsnZGVsZXRlJ10gPSBtYXBDYWNoZURlbGV0ZTtcbk1hcENhY2hlLnByb3RvdHlwZS5nZXQgPSBtYXBDYWNoZUdldDtcbk1hcENhY2hlLnByb3RvdHlwZS5oYXMgPSBtYXBDYWNoZUhhcztcbk1hcENhY2hlLnByb3RvdHlwZS5zZXQgPSBtYXBDYWNoZVNldDtcblxuLyoqXG4gKiBDcmVhdGVzIGEgc3RhY2sgY2FjaGUgb2JqZWN0IHRvIHN0b3JlIGtleS12YWx1ZSBwYWlycy5cbiAqXG4gKiBAcHJpdmF0ZVxuICogQGNvbnN0cnVjdG9yXG4gKiBAcGFyYW0ge0FycmF5fSBbZW50cmllc10gVGhlIGtleS12YWx1ZSBwYWlycyB0byBjYWNoZS5cbiAqL1xuZnVuY3Rpb24gU3RhY2soZW50cmllcykge1xuICB0aGlzLl9fZGF0YV9fID0gbmV3IExpc3RDYWNoZShlbnRyaWVzKTtcbn1cblxuLyoqXG4gKiBSZW1vdmVzIGFsbCBrZXktdmFsdWUgZW50cmllcyBmcm9tIHRoZSBzdGFjay5cbiAqXG4gKiBAcHJpdmF0ZVxuICogQG5hbWUgY2xlYXJcbiAqIEBtZW1iZXJPZiBTdGFja1xuICovXG5mdW5jdGlvbiBzdGFja0NsZWFyKCkge1xuICB0aGlzLl9fZGF0YV9fID0gbmV3IExpc3RDYWNoZTtcbn1cblxuLyoqXG4gKiBSZW1vdmVzIGBrZXlgIGFuZCBpdHMgdmFsdWUgZnJvbSB0aGUgc3RhY2suXG4gKlxuICogQHByaXZhdGVcbiAqIEBuYW1lIGRlbGV0ZVxuICogQG1lbWJlck9mIFN0YWNrXG4gKiBAcGFyYW0ge3N0cmluZ30ga2V5IFRoZSBrZXkgb2YgdGhlIHZhbHVlIHRvIHJlbW92ZS5cbiAqIEByZXR1cm5zIHtib29sZWFufSBSZXR1cm5zIGB0cnVlYCBpZiB0aGUgZW50cnkgd2FzIHJlbW92ZWQsIGVsc2UgYGZhbHNlYC5cbiAqL1xuZnVuY3Rpb24gc3RhY2tEZWxldGUoa2V5KSB7XG4gIHJldHVybiB0aGlzLl9fZGF0YV9fWydkZWxldGUnXShrZXkpO1xufVxuXG4vKipcbiAqIEdldHMgdGhlIHN0YWNrIHZhbHVlIGZvciBga2V5YC5cbiAqXG4gKiBAcHJpdmF0ZVxuICogQG5hbWUgZ2V0XG4gKiBAbWVtYmVyT2YgU3RhY2tcbiAqIEBwYXJhbSB7c3RyaW5nfSBrZXkgVGhlIGtleSBvZiB0aGUgdmFsdWUgdG8gZ2V0LlxuICogQHJldHVybnMgeyp9IFJldHVybnMgdGhlIGVudHJ5IHZhbHVlLlxuICovXG5mdW5jdGlvbiBzdGFja0dldChrZXkpIHtcbiAgcmV0dXJuIHRoaXMuX19kYXRhX18uZ2V0KGtleSk7XG59XG5cbi8qKlxuICogQ2hlY2tzIGlmIGEgc3RhY2sgdmFsdWUgZm9yIGBrZXlgIGV4aXN0cy5cbiAqXG4gKiBAcHJpdmF0ZVxuICogQG5hbWUgaGFzXG4gKiBAbWVtYmVyT2YgU3RhY2tcbiAqIEBwYXJhbSB7c3RyaW5nfSBrZXkgVGhlIGtleSBvZiB0aGUgZW50cnkgdG8gY2hlY2suXG4gKiBAcmV0dXJucyB7Ym9vbGVhbn0gUmV0dXJucyBgdHJ1ZWAgaWYgYW4gZW50cnkgZm9yIGBrZXlgIGV4aXN0cywgZWxzZSBgZmFsc2VgLlxuICovXG5mdW5jdGlvbiBzdGFja0hhcyhrZXkpIHtcbiAgcmV0dXJuIHRoaXMuX19kYXRhX18uaGFzKGtleSk7XG59XG5cbi8qKlxuICogU2V0cyB0aGUgc3RhY2sgYGtleWAgdG8gYHZhbHVlYC5cbiAqXG4gKiBAcHJpdmF0ZVxuICogQG5hbWUgc2V0XG4gKiBAbWVtYmVyT2YgU3RhY2tcbiAqIEBwYXJhbSB7c3RyaW5nfSBrZXkgVGhlIGtleSBvZiB0aGUgdmFsdWUgdG8gc2V0LlxuICogQHBhcmFtIHsqfSB2YWx1ZSBUaGUgdmFsdWUgdG8gc2V0LlxuICogQHJldHVybnMge09iamVjdH0gUmV0dXJucyB0aGUgc3RhY2sgY2FjaGUgaW5zdGFuY2UuXG4gKi9cbmZ1bmN0aW9uIHN0YWNrU2V0KGtleSwgdmFsdWUpIHtcbiAgdmFyIGNhY2hlID0gdGhpcy5fX2RhdGFfXztcbiAgaWYgKGNhY2hlIGluc3RhbmNlb2YgTGlzdENhY2hlKSB7XG4gICAgdmFyIHBhaXJzID0gY2FjaGUuX19kYXRhX187XG4gICAgaWYgKCFNYXAgfHwgKHBhaXJzLmxlbmd0aCA8IExBUkdFX0FSUkFZX1NJWkUgLSAxKSkge1xuICAgICAgcGFpcnMucHVzaChba2V5LCB2YWx1ZV0pO1xuICAgICAgcmV0dXJuIHRoaXM7XG4gICAgfVxuICAgIGNhY2hlID0gdGhpcy5fX2RhdGFfXyA9IG5ldyBNYXBDYWNoZShwYWlycyk7XG4gIH1cbiAgY2FjaGUuc2V0KGtleSwgdmFsdWUpO1xuICByZXR1cm4gdGhpcztcbn1cblxuLy8gQWRkIG1ldGhvZHMgdG8gYFN0YWNrYC5cblN0YWNrLnByb3RvdHlwZS5jbGVhciA9IHN0YWNrQ2xlYXI7XG5TdGFjay5wcm90b3R5cGVbJ2RlbGV0ZSddID0gc3RhY2tEZWxldGU7XG5TdGFjay5wcm90b3R5cGUuZ2V0ID0gc3RhY2tHZXQ7XG5TdGFjay5wcm90b3R5cGUuaGFzID0gc3RhY2tIYXM7XG5TdGFjay5wcm90b3R5cGUuc2V0ID0gc3RhY2tTZXQ7XG5cbi8qKlxuICogQ3JlYXRlcyBhbiBhcnJheSBvZiB0aGUgZW51bWVyYWJsZSBwcm9wZXJ0eSBuYW1lcyBvZiB0aGUgYXJyYXktbGlrZSBgdmFsdWVgLlxuICpcbiAqIEBwcml2YXRlXG4gKiBAcGFyYW0geyp9IHZhbHVlIFRoZSB2YWx1ZSB0byBxdWVyeS5cbiAqIEBwYXJhbSB7Ym9vbGVhbn0gaW5oZXJpdGVkIFNwZWNpZnkgcmV0dXJuaW5nIGluaGVyaXRlZCBwcm9wZXJ0eSBuYW1lcy5cbiAqIEByZXR1cm5zIHtBcnJheX0gUmV0dXJucyB0aGUgYXJyYXkgb2YgcHJvcGVydHkgbmFtZXMuXG4gKi9cbmZ1bmN0aW9uIGFycmF5TGlrZUtleXModmFsdWUsIGluaGVyaXRlZCkge1xuICAvLyBTYWZhcmkgOC4xIG1ha2VzIGBhcmd1bWVudHMuY2FsbGVlYCBlbnVtZXJhYmxlIGluIHN0cmljdCBtb2RlLlxuICAvLyBTYWZhcmkgOSBtYWtlcyBgYXJndW1lbnRzLmxlbmd0aGAgZW51bWVyYWJsZSBpbiBzdHJpY3QgbW9kZS5cbiAgdmFyIHJlc3VsdCA9IChpc0FycmF5KHZhbHVlKSB8fCBpc0FyZ3VtZW50cyh2YWx1ZSkpXG4gICAgPyBiYXNlVGltZXModmFsdWUubGVuZ3RoLCBTdHJpbmcpXG4gICAgOiBbXTtcblxuICB2YXIgbGVuZ3RoID0gcmVzdWx0Lmxlbmd0aCxcbiAgICAgIHNraXBJbmRleGVzID0gISFsZW5ndGg7XG5cbiAgZm9yICh2YXIga2V5IGluIHZhbHVlKSB7XG4gICAgaWYgKChpbmhlcml0ZWQgfHwgaGFzT3duUHJvcGVydHkuY2FsbCh2YWx1ZSwga2V5KSkgJiZcbiAgICAgICAgIShza2lwSW5kZXhlcyAmJiAoa2V5ID09ICdsZW5ndGgnIHx8IGlzSW5kZXgoa2V5LCBsZW5ndGgpKSkpIHtcbiAgICAgIHJlc3VsdC5wdXNoKGtleSk7XG4gICAgfVxuICB9XG4gIHJldHVybiByZXN1bHQ7XG59XG5cbi8qKlxuICogQXNzaWducyBgdmFsdWVgIHRvIGBrZXlgIG9mIGBvYmplY3RgIGlmIHRoZSBleGlzdGluZyB2YWx1ZSBpcyBub3QgZXF1aXZhbGVudFxuICogdXNpbmcgW2BTYW1lVmFsdWVaZXJvYF0oaHR0cDovL2VjbWEtaW50ZXJuYXRpb25hbC5vcmcvZWNtYS0yNjIvNy4wLyNzZWMtc2FtZXZhbHVlemVybylcbiAqIGZvciBlcXVhbGl0eSBjb21wYXJpc29ucy5cbiAqXG4gKiBAcHJpdmF0ZVxuICogQHBhcmFtIHtPYmplY3R9IG9iamVjdCBUaGUgb2JqZWN0IHRvIG1vZGlmeS5cbiAqIEBwYXJhbSB7c3RyaW5nfSBrZXkgVGhlIGtleSBvZiB0aGUgcHJvcGVydHkgdG8gYXNzaWduLlxuICogQHBhcmFtIHsqfSB2YWx1ZSBUaGUgdmFsdWUgdG8gYXNzaWduLlxuICovXG5mdW5jdGlvbiBhc3NpZ25WYWx1ZShvYmplY3QsIGtleSwgdmFsdWUpIHtcbiAgdmFyIG9ialZhbHVlID0gb2JqZWN0W2tleV07XG4gIGlmICghKGhhc093blByb3BlcnR5LmNhbGwob2JqZWN0LCBrZXkpICYmIGVxKG9ialZhbHVlLCB2YWx1ZSkpIHx8XG4gICAgICAodmFsdWUgPT09IHVuZGVmaW5lZCAmJiAhKGtleSBpbiBvYmplY3QpKSkge1xuICAgIG9iamVjdFtrZXldID0gdmFsdWU7XG4gIH1cbn1cblxuLyoqXG4gKiBHZXRzIHRoZSBpbmRleCBhdCB3aGljaCB0aGUgYGtleWAgaXMgZm91bmQgaW4gYGFycmF5YCBvZiBrZXktdmFsdWUgcGFpcnMuXG4gKlxuICogQHByaXZhdGVcbiAqIEBwYXJhbSB7QXJyYXl9IGFycmF5IFRoZSBhcnJheSB0byBpbnNwZWN0LlxuICogQHBhcmFtIHsqfSBrZXkgVGhlIGtleSB0byBzZWFyY2ggZm9yLlxuICogQHJldHVybnMge251bWJlcn0gUmV0dXJucyB0aGUgaW5kZXggb2YgdGhlIG1hdGNoZWQgdmFsdWUsIGVsc2UgYC0xYC5cbiAqL1xuZnVuY3Rpb24gYXNzb2NJbmRleE9mKGFycmF5LCBrZXkpIHtcbiAgdmFyIGxlbmd0aCA9IGFycmF5Lmxlbmd0aDtcbiAgd2hpbGUgKGxlbmd0aC0tKSB7XG4gICAgaWYgKGVxKGFycmF5W2xlbmd0aF1bMF0sIGtleSkpIHtcbiAgICAgIHJldHVybiBsZW5ndGg7XG4gICAgfVxuICB9XG4gIHJldHVybiAtMTtcbn1cblxuLyoqXG4gKiBUaGUgYmFzZSBpbXBsZW1lbnRhdGlvbiBvZiBgXy5hc3NpZ25gIHdpdGhvdXQgc3VwcG9ydCBmb3IgbXVsdGlwbGUgc291cmNlc1xuICogb3IgYGN1c3RvbWl6ZXJgIGZ1bmN0aW9ucy5cbiAqXG4gKiBAcHJpdmF0ZVxuICogQHBhcmFtIHtPYmplY3R9IG9iamVjdCBUaGUgZGVzdGluYXRpb24gb2JqZWN0LlxuICogQHBhcmFtIHtPYmplY3R9IHNvdXJjZSBUaGUgc291cmNlIG9iamVjdC5cbiAqIEByZXR1cm5zIHtPYmplY3R9IFJldHVybnMgYG9iamVjdGAuXG4gKi9cbmZ1bmN0aW9uIGJhc2VBc3NpZ24ob2JqZWN0LCBzb3VyY2UpIHtcbiAgcmV0dXJuIG9iamVjdCAmJiBjb3B5T2JqZWN0KHNvdXJjZSwga2V5cyhzb3VyY2UpLCBvYmplY3QpO1xufVxuXG4vKipcbiAqIFRoZSBiYXNlIGltcGxlbWVudGF0aW9uIG9mIGBfLmNsb25lYCBhbmQgYF8uY2xvbmVEZWVwYCB3aGljaCB0cmFja3NcbiAqIHRyYXZlcnNlZCBvYmplY3RzLlxuICpcbiAqIEBwcml2YXRlXG4gKiBAcGFyYW0geyp9IHZhbHVlIFRoZSB2YWx1ZSB0byBjbG9uZS5cbiAqIEBwYXJhbSB7Ym9vbGVhbn0gW2lzRGVlcF0gU3BlY2lmeSBhIGRlZXAgY2xvbmUuXG4gKiBAcGFyYW0ge2Jvb2xlYW59IFtpc0Z1bGxdIFNwZWNpZnkgYSBjbG9uZSBpbmNsdWRpbmcgc3ltYm9scy5cbiAqIEBwYXJhbSB7RnVuY3Rpb259IFtjdXN0b21pemVyXSBUaGUgZnVuY3Rpb24gdG8gY3VzdG9taXplIGNsb25pbmcuXG4gKiBAcGFyYW0ge3N0cmluZ30gW2tleV0gVGhlIGtleSBvZiBgdmFsdWVgLlxuICogQHBhcmFtIHtPYmplY3R9IFtvYmplY3RdIFRoZSBwYXJlbnQgb2JqZWN0IG9mIGB2YWx1ZWAuXG4gKiBAcGFyYW0ge09iamVjdH0gW3N0YWNrXSBUcmFja3MgdHJhdmVyc2VkIG9iamVjdHMgYW5kIHRoZWlyIGNsb25lIGNvdW50ZXJwYXJ0cy5cbiAqIEByZXR1cm5zIHsqfSBSZXR1cm5zIHRoZSBjbG9uZWQgdmFsdWUuXG4gKi9cbmZ1bmN0aW9uIGJhc2VDbG9uZSh2YWx1ZSwgaXNEZWVwLCBpc0Z1bGwsIGN1c3RvbWl6ZXIsIGtleSwgb2JqZWN0LCBzdGFjaykge1xuICB2YXIgcmVzdWx0O1xuICBpZiAoY3VzdG9taXplcikge1xuICAgIHJlc3VsdCA9IG9iamVjdCA/IGN1c3RvbWl6ZXIodmFsdWUsIGtleSwgb2JqZWN0LCBzdGFjaykgOiBjdXN0b21pemVyKHZhbHVlKTtcbiAgfVxuICBpZiAocmVzdWx0ICE9PSB1bmRlZmluZWQpIHtcbiAgICByZXR1cm4gcmVzdWx0O1xuICB9XG4gIGlmICghaXNPYmplY3QodmFsdWUpKSB7XG4gICAgcmV0dXJuIHZhbHVlO1xuICB9XG4gIHZhciBpc0FyciA9IGlzQXJyYXkodmFsdWUpO1xuICBpZiAoaXNBcnIpIHtcbiAgICByZXN1bHQgPSBpbml0Q2xvbmVBcnJheSh2YWx1ZSk7XG4gICAgaWYgKCFpc0RlZXApIHtcbiAgICAgIHJldHVybiBjb3B5QXJyYXkodmFsdWUsIHJlc3VsdCk7XG4gICAgfVxuICB9IGVsc2Uge1xuICAgIHZhciB0YWcgPSBnZXRUYWcodmFsdWUpLFxuICAgICAgICBpc0Z1bmMgPSB0YWcgPT0gZnVuY1RhZyB8fCB0YWcgPT0gZ2VuVGFnO1xuXG4gICAgaWYgKGlzQnVmZmVyKHZhbHVlKSkge1xuICAgICAgcmV0dXJuIGNsb25lQnVmZmVyKHZhbHVlLCBpc0RlZXApO1xuICAgIH1cbiAgICBpZiAodGFnID09IG9iamVjdFRhZyB8fCB0YWcgPT0gYXJnc1RhZyB8fCAoaXNGdW5jICYmICFvYmplY3QpKSB7XG4gICAgICBpZiAoaXNIb3N0T2JqZWN0KHZhbHVlKSkge1xuICAgICAgICByZXR1cm4gb2JqZWN0ID8gdmFsdWUgOiB7fTtcbiAgICAgIH1cbiAgICAgIHJlc3VsdCA9IGluaXRDbG9uZU9iamVjdChpc0Z1bmMgPyB7fSA6IHZhbHVlKTtcbiAgICAgIGlmICghaXNEZWVwKSB7XG4gICAgICAgIHJldHVybiBjb3B5U3ltYm9scyh2YWx1ZSwgYmFzZUFzc2lnbihyZXN1bHQsIHZhbHVlKSk7XG4gICAgICB9XG4gICAgfSBlbHNlIHtcbiAgICAgIGlmICghY2xvbmVhYmxlVGFnc1t0YWddKSB7XG4gICAgICAgIHJldHVybiBvYmplY3QgPyB2YWx1ZSA6IHt9O1xuICAgICAgfVxuICAgICAgcmVzdWx0ID0gaW5pdENsb25lQnlUYWcodmFsdWUsIHRhZywgYmFzZUNsb25lLCBpc0RlZXApO1xuICAgIH1cbiAgfVxuICAvLyBDaGVjayBmb3IgY2lyY3VsYXIgcmVmZXJlbmNlcyBhbmQgcmV0dXJuIGl0cyBjb3JyZXNwb25kaW5nIGNsb25lLlxuICBzdGFjayB8fCAoc3RhY2sgPSBuZXcgU3RhY2spO1xuICB2YXIgc3RhY2tlZCA9IHN0YWNrLmdldCh2YWx1ZSk7XG4gIGlmIChzdGFja2VkKSB7XG4gICAgcmV0dXJuIHN0YWNrZWQ7XG4gIH1cbiAgc3RhY2suc2V0KHZhbHVlLCByZXN1bHQpO1xuXG4gIGlmICghaXNBcnIpIHtcbiAgICB2YXIgcHJvcHMgPSBpc0Z1bGwgPyBnZXRBbGxLZXlzKHZhbHVlKSA6IGtleXModmFsdWUpO1xuICB9XG4gIGFycmF5RWFjaChwcm9wcyB8fCB2YWx1ZSwgZnVuY3Rpb24oc3ViVmFsdWUsIGtleSkge1xuICAgIGlmIChwcm9wcykge1xuICAgICAga2V5ID0gc3ViVmFsdWU7XG4gICAgICBzdWJWYWx1ZSA9IHZhbHVlW2tleV07XG4gICAgfVxuICAgIC8vIFJlY3Vyc2l2ZWx5IHBvcHVsYXRlIGNsb25lIChzdXNjZXB0aWJsZSB0byBjYWxsIHN0YWNrIGxpbWl0cykuXG4gICAgYXNzaWduVmFsdWUocmVzdWx0LCBrZXksIGJhc2VDbG9uZShzdWJWYWx1ZSwgaXNEZWVwLCBpc0Z1bGwsIGN1c3RvbWl6ZXIsIGtleSwgdmFsdWUsIHN0YWNrKSk7XG4gIH0pO1xuICByZXR1cm4gcmVzdWx0O1xufVxuXG4vKipcbiAqIFRoZSBiYXNlIGltcGxlbWVudGF0aW9uIG9mIGBfLmNyZWF0ZWAgd2l0aG91dCBzdXBwb3J0IGZvciBhc3NpZ25pbmdcbiAqIHByb3BlcnRpZXMgdG8gdGhlIGNyZWF0ZWQgb2JqZWN0LlxuICpcbiAqIEBwcml2YXRlXG4gKiBAcGFyYW0ge09iamVjdH0gcHJvdG90eXBlIFRoZSBvYmplY3QgdG8gaW5oZXJpdCBmcm9tLlxuICogQHJldHVybnMge09iamVjdH0gUmV0dXJucyB0aGUgbmV3IG9iamVjdC5cbiAqL1xuZnVuY3Rpb24gYmFzZUNyZWF0ZShwcm90bykge1xuICByZXR1cm4gaXNPYmplY3QocHJvdG8pID8gb2JqZWN0Q3JlYXRlKHByb3RvKSA6IHt9O1xufVxuXG4vKipcbiAqIFRoZSBiYXNlIGltcGxlbWVudGF0aW9uIG9mIGBnZXRBbGxLZXlzYCBhbmQgYGdldEFsbEtleXNJbmAgd2hpY2ggdXNlc1xuICogYGtleXNGdW5jYCBhbmQgYHN5bWJvbHNGdW5jYCB0byBnZXQgdGhlIGVudW1lcmFibGUgcHJvcGVydHkgbmFtZXMgYW5kXG4gKiBzeW1ib2xzIG9mIGBvYmplY3RgLlxuICpcbiAqIEBwcml2YXRlXG4gKiBAcGFyYW0ge09iamVjdH0gb2JqZWN0IFRoZSBvYmplY3QgdG8gcXVlcnkuXG4gKiBAcGFyYW0ge0Z1bmN0aW9ufSBrZXlzRnVuYyBUaGUgZnVuY3Rpb24gdG8gZ2V0IHRoZSBrZXlzIG9mIGBvYmplY3RgLlxuICogQHBhcmFtIHtGdW5jdGlvbn0gc3ltYm9sc0Z1bmMgVGhlIGZ1bmN0aW9uIHRvIGdldCB0aGUgc3ltYm9scyBvZiBgb2JqZWN0YC5cbiAqIEByZXR1cm5zIHtBcnJheX0gUmV0dXJucyB0aGUgYXJyYXkgb2YgcHJvcGVydHkgbmFtZXMgYW5kIHN5bWJvbHMuXG4gKi9cbmZ1bmN0aW9uIGJhc2VHZXRBbGxLZXlzKG9iamVjdCwga2V5c0Z1bmMsIHN5bWJvbHNGdW5jKSB7XG4gIHZhciByZXN1bHQgPSBrZXlzRnVuYyhvYmplY3QpO1xuICByZXR1cm4gaXNBcnJheShvYmplY3QpID8gcmVzdWx0IDogYXJyYXlQdXNoKHJlc3VsdCwgc3ltYm9sc0Z1bmMob2JqZWN0KSk7XG59XG5cbi8qKlxuICogVGhlIGJhc2UgaW1wbGVtZW50YXRpb24gb2YgYGdldFRhZ2AuXG4gKlxuICogQHByaXZhdGVcbiAqIEBwYXJhbSB7Kn0gdmFsdWUgVGhlIHZhbHVlIHRvIHF1ZXJ5LlxuICogQHJldHVybnMge3N0cmluZ30gUmV0dXJucyB0aGUgYHRvU3RyaW5nVGFnYC5cbiAqL1xuZnVuY3Rpb24gYmFzZUdldFRhZyh2YWx1ZSkge1xuICByZXR1cm4gb2JqZWN0VG9TdHJpbmcuY2FsbCh2YWx1ZSk7XG59XG5cbi8qKlxuICogVGhlIGJhc2UgaW1wbGVtZW50YXRpb24gb2YgYF8uaXNOYXRpdmVgIHdpdGhvdXQgYmFkIHNoaW0gY2hlY2tzLlxuICpcbiAqIEBwcml2YXRlXG4gKiBAcGFyYW0geyp9IHZhbHVlIFRoZSB2YWx1ZSB0byBjaGVjay5cbiAqIEByZXR1cm5zIHtib29sZWFufSBSZXR1cm5zIGB0cnVlYCBpZiBgdmFsdWVgIGlzIGEgbmF0aXZlIGZ1bmN0aW9uLFxuICogIGVsc2UgYGZhbHNlYC5cbiAqL1xuZnVuY3Rpb24gYmFzZUlzTmF0aXZlKHZhbHVlKSB7XG4gIGlmICghaXNPYmplY3QodmFsdWUpIHx8IGlzTWFza2VkKHZhbHVlKSkge1xuICAgIHJldHVybiBmYWxzZTtcbiAgfVxuICB2YXIgcGF0dGVybiA9IChpc0Z1bmN0aW9uKHZhbHVlKSB8fCBpc0hvc3RPYmplY3QodmFsdWUpKSA/IHJlSXNOYXRpdmUgOiByZUlzSG9zdEN0b3I7XG4gIHJldHVybiBwYXR0ZXJuLnRlc3QodG9Tb3VyY2UodmFsdWUpKTtcbn1cblxuLyoqXG4gKiBUaGUgYmFzZSBpbXBsZW1lbnRhdGlvbiBvZiBgXy5rZXlzYCB3aGljaCBkb2Vzbid0IHRyZWF0IHNwYXJzZSBhcnJheXMgYXMgZGVuc2UuXG4gKlxuICogQHByaXZhdGVcbiAqIEBwYXJhbSB7T2JqZWN0fSBvYmplY3QgVGhlIG9iamVjdCB0byBxdWVyeS5cbiAqIEByZXR1cm5zIHtBcnJheX0gUmV0dXJucyB0aGUgYXJyYXkgb2YgcHJvcGVydHkgbmFtZXMuXG4gKi9cbmZ1bmN0aW9uIGJhc2VLZXlzKG9iamVjdCkge1xuICBpZiAoIWlzUHJvdG90eXBlKG9iamVjdCkpIHtcbiAgICByZXR1cm4gbmF0aXZlS2V5cyhvYmplY3QpO1xuICB9XG4gIHZhciByZXN1bHQgPSBbXTtcbiAgZm9yICh2YXIga2V5IGluIE9iamVjdChvYmplY3QpKSB7XG4gICAgaWYgKGhhc093blByb3BlcnR5LmNhbGwob2JqZWN0LCBrZXkpICYmIGtleSAhPSAnY29uc3RydWN0b3InKSB7XG4gICAgICByZXN1bHQucHVzaChrZXkpO1xuICAgIH1cbiAgfVxuICByZXR1cm4gcmVzdWx0O1xufVxuXG4vKipcbiAqIENyZWF0ZXMgYSBjbG9uZSBvZiAgYGJ1ZmZlcmAuXG4gKlxuICogQHByaXZhdGVcbiAqIEBwYXJhbSB7QnVmZmVyfSBidWZmZXIgVGhlIGJ1ZmZlciB0byBjbG9uZS5cbiAqIEBwYXJhbSB7Ym9vbGVhbn0gW2lzRGVlcF0gU3BlY2lmeSBhIGRlZXAgY2xvbmUuXG4gKiBAcmV0dXJucyB7QnVmZmVyfSBSZXR1cm5zIHRoZSBjbG9uZWQgYnVmZmVyLlxuICovXG5mdW5jdGlvbiBjbG9uZUJ1ZmZlcihidWZmZXIsIGlzRGVlcCkge1xuICBpZiAoaXNEZWVwKSB7XG4gICAgcmV0dXJuIGJ1ZmZlci5zbGljZSgpO1xuICB9XG4gIHZhciByZXN1bHQgPSBuZXcgYnVmZmVyLmNvbnN0cnVjdG9yKGJ1ZmZlci5sZW5ndGgpO1xuICBidWZmZXIuY29weShyZXN1bHQpO1xuICByZXR1cm4gcmVzdWx0O1xufVxuXG4vKipcbiAqIENyZWF0ZXMgYSBjbG9uZSBvZiBgYXJyYXlCdWZmZXJgLlxuICpcbiAqIEBwcml2YXRlXG4gKiBAcGFyYW0ge0FycmF5QnVmZmVyfSBhcnJheUJ1ZmZlciBUaGUgYXJyYXkgYnVmZmVyIHRvIGNsb25lLlxuICogQHJldHVybnMge0FycmF5QnVmZmVyfSBSZXR1cm5zIHRoZSBjbG9uZWQgYXJyYXkgYnVmZmVyLlxuICovXG5mdW5jdGlvbiBjbG9uZUFycmF5QnVmZmVyKGFycmF5QnVmZmVyKSB7XG4gIHZhciByZXN1bHQgPSBuZXcgYXJyYXlCdWZmZXIuY29uc3RydWN0b3IoYXJyYXlCdWZmZXIuYnl0ZUxlbmd0aCk7XG4gIG5ldyBVaW50OEFycmF5KHJlc3VsdCkuc2V0KG5ldyBVaW50OEFycmF5KGFycmF5QnVmZmVyKSk7XG4gIHJldHVybiByZXN1bHQ7XG59XG5cbi8qKlxuICogQ3JlYXRlcyBhIGNsb25lIG9mIGBkYXRhVmlld2AuXG4gKlxuICogQHByaXZhdGVcbiAqIEBwYXJhbSB7T2JqZWN0fSBkYXRhVmlldyBUaGUgZGF0YSB2aWV3IHRvIGNsb25lLlxuICogQHBhcmFtIHtib29sZWFufSBbaXNEZWVwXSBTcGVjaWZ5IGEgZGVlcCBjbG9uZS5cbiAqIEByZXR1cm5zIHtPYmplY3R9IFJldHVybnMgdGhlIGNsb25lZCBkYXRhIHZpZXcuXG4gKi9cbmZ1bmN0aW9uIGNsb25lRGF0YVZpZXcoZGF0YVZpZXcsIGlzRGVlcCkge1xuICB2YXIgYnVmZmVyID0gaXNEZWVwID8gY2xvbmVBcnJheUJ1ZmZlcihkYXRhVmlldy5idWZmZXIpIDogZGF0YVZpZXcuYnVmZmVyO1xuICByZXR1cm4gbmV3IGRhdGFWaWV3LmNvbnN0cnVjdG9yKGJ1ZmZlciwgZGF0YVZpZXcuYnl0ZU9mZnNldCwgZGF0YVZpZXcuYnl0ZUxlbmd0aCk7XG59XG5cbi8qKlxuICogQ3JlYXRlcyBhIGNsb25lIG9mIGBtYXBgLlxuICpcbiAqIEBwcml2YXRlXG4gKiBAcGFyYW0ge09iamVjdH0gbWFwIFRoZSBtYXAgdG8gY2xvbmUuXG4gKiBAcGFyYW0ge0Z1bmN0aW9ufSBjbG9uZUZ1bmMgVGhlIGZ1bmN0aW9uIHRvIGNsb25lIHZhbHVlcy5cbiAqIEBwYXJhbSB7Ym9vbGVhbn0gW2lzRGVlcF0gU3BlY2lmeSBhIGRlZXAgY2xvbmUuXG4gKiBAcmV0dXJucyB7T2JqZWN0fSBSZXR1cm5zIHRoZSBjbG9uZWQgbWFwLlxuICovXG5mdW5jdGlvbiBjbG9uZU1hcChtYXAsIGlzRGVlcCwgY2xvbmVGdW5jKSB7XG4gIHZhciBhcnJheSA9IGlzRGVlcCA/IGNsb25lRnVuYyhtYXBUb0FycmF5KG1hcCksIHRydWUpIDogbWFwVG9BcnJheShtYXApO1xuICByZXR1cm4gYXJyYXlSZWR1Y2UoYXJyYXksIGFkZE1hcEVudHJ5LCBuZXcgbWFwLmNvbnN0cnVjdG9yKTtcbn1cblxuLyoqXG4gKiBDcmVhdGVzIGEgY2xvbmUgb2YgYHJlZ2V4cGAuXG4gKlxuICogQHByaXZhdGVcbiAqIEBwYXJhbSB7T2JqZWN0fSByZWdleHAgVGhlIHJlZ2V4cCB0byBjbG9uZS5cbiAqIEByZXR1cm5zIHtPYmplY3R9IFJldHVybnMgdGhlIGNsb25lZCByZWdleHAuXG4gKi9cbmZ1bmN0aW9uIGNsb25lUmVnRXhwKHJlZ2V4cCkge1xuICB2YXIgcmVzdWx0ID0gbmV3IHJlZ2V4cC5jb25zdHJ1Y3RvcihyZWdleHAuc291cmNlLCByZUZsYWdzLmV4ZWMocmVnZXhwKSk7XG4gIHJlc3VsdC5sYXN0SW5kZXggPSByZWdleHAubGFzdEluZGV4O1xuICByZXR1cm4gcmVzdWx0O1xufVxuXG4vKipcbiAqIENyZWF0ZXMgYSBjbG9uZSBvZiBgc2V0YC5cbiAqXG4gKiBAcHJpdmF0ZVxuICogQHBhcmFtIHtPYmplY3R9IHNldCBUaGUgc2V0IHRvIGNsb25lLlxuICogQHBhcmFtIHtGdW5jdGlvbn0gY2xvbmVGdW5jIFRoZSBmdW5jdGlvbiB0byBjbG9uZSB2YWx1ZXMuXG4gKiBAcGFyYW0ge2Jvb2xlYW59IFtpc0RlZXBdIFNwZWNpZnkgYSBkZWVwIGNsb25lLlxuICogQHJldHVybnMge09iamVjdH0gUmV0dXJucyB0aGUgY2xvbmVkIHNldC5cbiAqL1xuZnVuY3Rpb24gY2xvbmVTZXQoc2V0LCBpc0RlZXAsIGNsb25lRnVuYykge1xuICB2YXIgYXJyYXkgPSBpc0RlZXAgPyBjbG9uZUZ1bmMoc2V0VG9BcnJheShzZXQpLCB0cnVlKSA6IHNldFRvQXJyYXkoc2V0KTtcbiAgcmV0dXJuIGFycmF5UmVkdWNlKGFycmF5LCBhZGRTZXRFbnRyeSwgbmV3IHNldC5jb25zdHJ1Y3Rvcik7XG59XG5cbi8qKlxuICogQ3JlYXRlcyBhIGNsb25lIG9mIHRoZSBgc3ltYm9sYCBvYmplY3QuXG4gKlxuICogQHByaXZhdGVcbiAqIEBwYXJhbSB7T2JqZWN0fSBzeW1ib2wgVGhlIHN5bWJvbCBvYmplY3QgdG8gY2xvbmUuXG4gKiBAcmV0dXJucyB7T2JqZWN0fSBSZXR1cm5zIHRoZSBjbG9uZWQgc3ltYm9sIG9iamVjdC5cbiAqL1xuZnVuY3Rpb24gY2xvbmVTeW1ib2woc3ltYm9sKSB7XG4gIHJldHVybiBzeW1ib2xWYWx1ZU9mID8gT2JqZWN0KHN5bWJvbFZhbHVlT2YuY2FsbChzeW1ib2wpKSA6IHt9O1xufVxuXG4vKipcbiAqIENyZWF0ZXMgYSBjbG9uZSBvZiBgdHlwZWRBcnJheWAuXG4gKlxuICogQHByaXZhdGVcbiAqIEBwYXJhbSB7T2JqZWN0fSB0eXBlZEFycmF5IFRoZSB0eXBlZCBhcnJheSB0byBjbG9uZS5cbiAqIEBwYXJhbSB7Ym9vbGVhbn0gW2lzRGVlcF0gU3BlY2lmeSBhIGRlZXAgY2xvbmUuXG4gKiBAcmV0dXJucyB7T2JqZWN0fSBSZXR1cm5zIHRoZSBjbG9uZWQgdHlwZWQgYXJyYXkuXG4gKi9cbmZ1bmN0aW9uIGNsb25lVHlwZWRBcnJheSh0eXBlZEFycmF5LCBpc0RlZXApIHtcbiAgdmFyIGJ1ZmZlciA9IGlzRGVlcCA/IGNsb25lQXJyYXlCdWZmZXIodHlwZWRBcnJheS5idWZmZXIpIDogdHlwZWRBcnJheS5idWZmZXI7XG4gIHJldHVybiBuZXcgdHlwZWRBcnJheS5jb25zdHJ1Y3RvcihidWZmZXIsIHR5cGVkQXJyYXkuYnl0ZU9mZnNldCwgdHlwZWRBcnJheS5sZW5ndGgpO1xufVxuXG4vKipcbiAqIENvcGllcyB0aGUgdmFsdWVzIG9mIGBzb3VyY2VgIHRvIGBhcnJheWAuXG4gKlxuICogQHByaXZhdGVcbiAqIEBwYXJhbSB7QXJyYXl9IHNvdXJjZSBUaGUgYXJyYXkgdG8gY29weSB2YWx1ZXMgZnJvbS5cbiAqIEBwYXJhbSB7QXJyYXl9IFthcnJheT1bXV0gVGhlIGFycmF5IHRvIGNvcHkgdmFsdWVzIHRvLlxuICogQHJldHVybnMge0FycmF5fSBSZXR1cm5zIGBhcnJheWAuXG4gKi9cbmZ1bmN0aW9uIGNvcHlBcnJheShzb3VyY2UsIGFycmF5KSB7XG4gIHZhciBpbmRleCA9IC0xLFxuICAgICAgbGVuZ3RoID0gc291cmNlLmxlbmd0aDtcblxuICBhcnJheSB8fCAoYXJyYXkgPSBBcnJheShsZW5ndGgpKTtcbiAgd2hpbGUgKCsraW5kZXggPCBsZW5ndGgpIHtcbiAgICBhcnJheVtpbmRleF0gPSBzb3VyY2VbaW5kZXhdO1xuICB9XG4gIHJldHVybiBhcnJheTtcbn1cblxuLyoqXG4gKiBDb3BpZXMgcHJvcGVydGllcyBvZiBgc291cmNlYCB0byBgb2JqZWN0YC5cbiAqXG4gKiBAcHJpdmF0ZVxuICogQHBhcmFtIHtPYmplY3R9IHNvdXJjZSBUaGUgb2JqZWN0IHRvIGNvcHkgcHJvcGVydGllcyBmcm9tLlxuICogQHBhcmFtIHtBcnJheX0gcHJvcHMgVGhlIHByb3BlcnR5IGlkZW50aWZpZXJzIHRvIGNvcHkuXG4gKiBAcGFyYW0ge09iamVjdH0gW29iamVjdD17fV0gVGhlIG9iamVjdCB0byBjb3B5IHByb3BlcnRpZXMgdG8uXG4gKiBAcGFyYW0ge0Z1bmN0aW9ufSBbY3VzdG9taXplcl0gVGhlIGZ1bmN0aW9uIHRvIGN1c3RvbWl6ZSBjb3BpZWQgdmFsdWVzLlxuICogQHJldHVybnMge09iamVjdH0gUmV0dXJucyBgb2JqZWN0YC5cbiAqL1xuZnVuY3Rpb24gY29weU9iamVjdChzb3VyY2UsIHByb3BzLCBvYmplY3QsIGN1c3RvbWl6ZXIpIHtcbiAgb2JqZWN0IHx8IChvYmplY3QgPSB7fSk7XG5cbiAgdmFyIGluZGV4ID0gLTEsXG4gICAgICBsZW5ndGggPSBwcm9wcy5sZW5ndGg7XG5cbiAgd2hpbGUgKCsraW5kZXggPCBsZW5ndGgpIHtcbiAgICB2YXIga2V5ID0gcHJvcHNbaW5kZXhdO1xuXG4gICAgdmFyIG5ld1ZhbHVlID0gY3VzdG9taXplclxuICAgICAgPyBjdXN0b21pemVyKG9iamVjdFtrZXldLCBzb3VyY2Vba2V5XSwga2V5LCBvYmplY3QsIHNvdXJjZSlcbiAgICAgIDogdW5kZWZpbmVkO1xuXG4gICAgYXNzaWduVmFsdWUob2JqZWN0LCBrZXksIG5ld1ZhbHVlID09PSB1bmRlZmluZWQgPyBzb3VyY2Vba2V5XSA6IG5ld1ZhbHVlKTtcbiAgfVxuICByZXR1cm4gb2JqZWN0O1xufVxuXG4vKipcbiAqIENvcGllcyBvd24gc3ltYm9sIHByb3BlcnRpZXMgb2YgYHNvdXJjZWAgdG8gYG9iamVjdGAuXG4gKlxuICogQHByaXZhdGVcbiAqIEBwYXJhbSB7T2JqZWN0fSBzb3VyY2UgVGhlIG9iamVjdCB0byBjb3B5IHN5bWJvbHMgZnJvbS5cbiAqIEBwYXJhbSB7T2JqZWN0fSBbb2JqZWN0PXt9XSBUaGUgb2JqZWN0IHRvIGNvcHkgc3ltYm9scyB0by5cbiAqIEByZXR1cm5zIHtPYmplY3R9IFJldHVybnMgYG9iamVjdGAuXG4gKi9cbmZ1bmN0aW9uIGNvcHlTeW1ib2xzKHNvdXJjZSwgb2JqZWN0KSB7XG4gIHJldHVybiBjb3B5T2JqZWN0KHNvdXJjZSwgZ2V0U3ltYm9scyhzb3VyY2UpLCBvYmplY3QpO1xufVxuXG4vKipcbiAqIENyZWF0ZXMgYW4gYXJyYXkgb2Ygb3duIGVudW1lcmFibGUgcHJvcGVydHkgbmFtZXMgYW5kIHN5bWJvbHMgb2YgYG9iamVjdGAuXG4gKlxuICogQHByaXZhdGVcbiAqIEBwYXJhbSB7T2JqZWN0fSBvYmplY3QgVGhlIG9iamVjdCB0byBxdWVyeS5cbiAqIEByZXR1cm5zIHtBcnJheX0gUmV0dXJucyB0aGUgYXJyYXkgb2YgcHJvcGVydHkgbmFtZXMgYW5kIHN5bWJvbHMuXG4gKi9cbmZ1bmN0aW9uIGdldEFsbEtleXMob2JqZWN0KSB7XG4gIHJldHVybiBiYXNlR2V0QWxsS2V5cyhvYmplY3QsIGtleXMsIGdldFN5bWJvbHMpO1xufVxuXG4vKipcbiAqIEdldHMgdGhlIGRhdGEgZm9yIGBtYXBgLlxuICpcbiAqIEBwcml2YXRlXG4gKiBAcGFyYW0ge09iamVjdH0gbWFwIFRoZSBtYXAgdG8gcXVlcnkuXG4gKiBAcGFyYW0ge3N0cmluZ30ga2V5IFRoZSByZWZlcmVuY2Uga2V5LlxuICogQHJldHVybnMgeyp9IFJldHVybnMgdGhlIG1hcCBkYXRhLlxuICovXG5mdW5jdGlvbiBnZXRNYXBEYXRhKG1hcCwga2V5KSB7XG4gIHZhciBkYXRhID0gbWFwLl9fZGF0YV9fO1xuICByZXR1cm4gaXNLZXlhYmxlKGtleSlcbiAgICA/IGRhdGFbdHlwZW9mIGtleSA9PSAnc3RyaW5nJyA/ICdzdHJpbmcnIDogJ2hhc2gnXVxuICAgIDogZGF0YS5tYXA7XG59XG5cbi8qKlxuICogR2V0cyB0aGUgbmF0aXZlIGZ1bmN0aW9uIGF0IGBrZXlgIG9mIGBvYmplY3RgLlxuICpcbiAqIEBwcml2YXRlXG4gKiBAcGFyYW0ge09iamVjdH0gb2JqZWN0IFRoZSBvYmplY3QgdG8gcXVlcnkuXG4gKiBAcGFyYW0ge3N0cmluZ30ga2V5IFRoZSBrZXkgb2YgdGhlIG1ldGhvZCB0byBnZXQuXG4gKiBAcmV0dXJucyB7Kn0gUmV0dXJucyB0aGUgZnVuY3Rpb24gaWYgaXQncyBuYXRpdmUsIGVsc2UgYHVuZGVmaW5lZGAuXG4gKi9cbmZ1bmN0aW9uIGdldE5hdGl2ZShvYmplY3QsIGtleSkge1xuICB2YXIgdmFsdWUgPSBnZXRWYWx1ZShvYmplY3QsIGtleSk7XG4gIHJldHVybiBiYXNlSXNOYXRpdmUodmFsdWUpID8gdmFsdWUgOiB1bmRlZmluZWQ7XG59XG5cbi8qKlxuICogQ3JlYXRlcyBhbiBhcnJheSBvZiB0aGUgb3duIGVudW1lcmFibGUgc3ltYm9sIHByb3BlcnRpZXMgb2YgYG9iamVjdGAuXG4gKlxuICogQHByaXZhdGVcbiAqIEBwYXJhbSB7T2JqZWN0fSBvYmplY3QgVGhlIG9iamVjdCB0byBxdWVyeS5cbiAqIEByZXR1cm5zIHtBcnJheX0gUmV0dXJucyB0aGUgYXJyYXkgb2Ygc3ltYm9scy5cbiAqL1xudmFyIGdldFN5bWJvbHMgPSBuYXRpdmVHZXRTeW1ib2xzID8gb3ZlckFyZyhuYXRpdmVHZXRTeW1ib2xzLCBPYmplY3QpIDogc3R1YkFycmF5O1xuXG4vKipcbiAqIEdldHMgdGhlIGB0b1N0cmluZ1RhZ2Agb2YgYHZhbHVlYC5cbiAqXG4gKiBAcHJpdmF0ZVxuICogQHBhcmFtIHsqfSB2YWx1ZSBUaGUgdmFsdWUgdG8gcXVlcnkuXG4gKiBAcmV0dXJucyB7c3RyaW5nfSBSZXR1cm5zIHRoZSBgdG9TdHJpbmdUYWdgLlxuICovXG52YXIgZ2V0VGFnID0gYmFzZUdldFRhZztcblxuLy8gRmFsbGJhY2sgZm9yIGRhdGEgdmlld3MsIG1hcHMsIHNldHMsIGFuZCB3ZWFrIG1hcHMgaW4gSUUgMTEsXG4vLyBmb3IgZGF0YSB2aWV3cyBpbiBFZGdlIDwgMTQsIGFuZCBwcm9taXNlcyBpbiBOb2RlLmpzLlxuaWYgKChEYXRhVmlldyAmJiBnZXRUYWcobmV3IERhdGFWaWV3KG5ldyBBcnJheUJ1ZmZlcigxKSkpICE9IGRhdGFWaWV3VGFnKSB8fFxuICAgIChNYXAgJiYgZ2V0VGFnKG5ldyBNYXApICE9IG1hcFRhZykgfHxcbiAgICAoUHJvbWlzZSAmJiBnZXRUYWcoUHJvbWlzZS5yZXNvbHZlKCkpICE9IHByb21pc2VUYWcpIHx8XG4gICAgKFNldCAmJiBnZXRUYWcobmV3IFNldCkgIT0gc2V0VGFnKSB8fFxuICAgIChXZWFrTWFwICYmIGdldFRhZyhuZXcgV2Vha01hcCkgIT0gd2Vha01hcFRhZykpIHtcbiAgZ2V0VGFnID0gZnVuY3Rpb24odmFsdWUpIHtcbiAgICB2YXIgcmVzdWx0ID0gb2JqZWN0VG9TdHJpbmcuY2FsbCh2YWx1ZSksXG4gICAgICAgIEN0b3IgPSByZXN1bHQgPT0gb2JqZWN0VGFnID8gdmFsdWUuY29uc3RydWN0b3IgOiB1bmRlZmluZWQsXG4gICAgICAgIGN0b3JTdHJpbmcgPSBDdG9yID8gdG9Tb3VyY2UoQ3RvcikgOiB1bmRlZmluZWQ7XG5cbiAgICBpZiAoY3RvclN0cmluZykge1xuICAgICAgc3dpdGNoIChjdG9yU3RyaW5nKSB7XG4gICAgICAgIGNhc2UgZGF0YVZpZXdDdG9yU3RyaW5nOiByZXR1cm4gZGF0YVZpZXdUYWc7XG4gICAgICAgIGNhc2UgbWFwQ3RvclN0cmluZzogcmV0dXJuIG1hcFRhZztcbiAgICAgICAgY2FzZSBwcm9taXNlQ3RvclN0cmluZzogcmV0dXJuIHByb21pc2VUYWc7XG4gICAgICAgIGNhc2Ugc2V0Q3RvclN0cmluZzogcmV0dXJuIHNldFRhZztcbiAgICAgICAgY2FzZSB3ZWFrTWFwQ3RvclN0cmluZzogcmV0dXJuIHdlYWtNYXBUYWc7XG4gICAgICB9XG4gICAgfVxuICAgIHJldHVybiByZXN1bHQ7XG4gIH07XG59XG5cbi8qKlxuICogSW5pdGlhbGl6ZXMgYW4gYXJyYXkgY2xvbmUuXG4gKlxuICogQHByaXZhdGVcbiAqIEBwYXJhbSB7QXJyYXl9IGFycmF5IFRoZSBhcnJheSB0byBjbG9uZS5cbiAqIEByZXR1cm5zIHtBcnJheX0gUmV0dXJucyB0aGUgaW5pdGlhbGl6ZWQgY2xvbmUuXG4gKi9cbmZ1bmN0aW9uIGluaXRDbG9uZUFycmF5KGFycmF5KSB7XG4gIHZhciBsZW5ndGggPSBhcnJheS5sZW5ndGgsXG4gICAgICByZXN1bHQgPSBhcnJheS5jb25zdHJ1Y3RvcihsZW5ndGgpO1xuXG4gIC8vIEFkZCBwcm9wZXJ0aWVzIGFzc2lnbmVkIGJ5IGBSZWdFeHAjZXhlY2AuXG4gIGlmIChsZW5ndGggJiYgdHlwZW9mIGFycmF5WzBdID09ICdzdHJpbmcnICYmIGhhc093blByb3BlcnR5LmNhbGwoYXJyYXksICdpbmRleCcpKSB7XG4gICAgcmVzdWx0LmluZGV4ID0gYXJyYXkuaW5kZXg7XG4gICAgcmVzdWx0LmlucHV0ID0gYXJyYXkuaW5wdXQ7XG4gIH1cbiAgcmV0dXJuIHJlc3VsdDtcbn1cblxuLyoqXG4gKiBJbml0aWFsaXplcyBhbiBvYmplY3QgY2xvbmUuXG4gKlxuICogQHByaXZhdGVcbiAqIEBwYXJhbSB7T2JqZWN0fSBvYmplY3QgVGhlIG9iamVjdCB0byBjbG9uZS5cbiAqIEByZXR1cm5zIHtPYmplY3R9IFJldHVybnMgdGhlIGluaXRpYWxpemVkIGNsb25lLlxuICovXG5mdW5jdGlvbiBpbml0Q2xvbmVPYmplY3Qob2JqZWN0KSB7XG4gIHJldHVybiAodHlwZW9mIG9iamVjdC5jb25zdHJ1Y3RvciA9PSAnZnVuY3Rpb24nICYmICFpc1Byb3RvdHlwZShvYmplY3QpKVxuICAgID8gYmFzZUNyZWF0ZShnZXRQcm90b3R5cGUob2JqZWN0KSlcbiAgICA6IHt9O1xufVxuXG4vKipcbiAqIEluaXRpYWxpemVzIGFuIG9iamVjdCBjbG9uZSBiYXNlZCBvbiBpdHMgYHRvU3RyaW5nVGFnYC5cbiAqXG4gKiAqKk5vdGU6KiogVGhpcyBmdW5jdGlvbiBvbmx5IHN1cHBvcnRzIGNsb25pbmcgdmFsdWVzIHdpdGggdGFncyBvZlxuICogYEJvb2xlYW5gLCBgRGF0ZWAsIGBFcnJvcmAsIGBOdW1iZXJgLCBgUmVnRXhwYCwgb3IgYFN0cmluZ2AuXG4gKlxuICogQHByaXZhdGVcbiAqIEBwYXJhbSB7T2JqZWN0fSBvYmplY3QgVGhlIG9iamVjdCB0byBjbG9uZS5cbiAqIEBwYXJhbSB7c3RyaW5nfSB0YWcgVGhlIGB0b1N0cmluZ1RhZ2Agb2YgdGhlIG9iamVjdCB0byBjbG9uZS5cbiAqIEBwYXJhbSB7RnVuY3Rpb259IGNsb25lRnVuYyBUaGUgZnVuY3Rpb24gdG8gY2xvbmUgdmFsdWVzLlxuICogQHBhcmFtIHtib29sZWFufSBbaXNEZWVwXSBTcGVjaWZ5IGEgZGVlcCBjbG9uZS5cbiAqIEByZXR1cm5zIHtPYmplY3R9IFJldHVybnMgdGhlIGluaXRpYWxpemVkIGNsb25lLlxuICovXG5mdW5jdGlvbiBpbml0Q2xvbmVCeVRhZyhvYmplY3QsIHRhZywgY2xvbmVGdW5jLCBpc0RlZXApIHtcbiAgdmFyIEN0b3IgPSBvYmplY3QuY29uc3RydWN0b3I7XG4gIHN3aXRjaCAodGFnKSB7XG4gICAgY2FzZSBhcnJheUJ1ZmZlclRhZzpcbiAgICAgIHJldHVybiBjbG9uZUFycmF5QnVmZmVyKG9iamVjdCk7XG5cbiAgICBjYXNlIGJvb2xUYWc6XG4gICAgY2FzZSBkYXRlVGFnOlxuICAgICAgcmV0dXJuIG5ldyBDdG9yKCtvYmplY3QpO1xuXG4gICAgY2FzZSBkYXRhVmlld1RhZzpcbiAgICAgIHJldHVybiBjbG9uZURhdGFWaWV3KG9iamVjdCwgaXNEZWVwKTtcblxuICAgIGNhc2UgZmxvYXQzMlRhZzogY2FzZSBmbG9hdDY0VGFnOlxuICAgIGNhc2UgaW50OFRhZzogY2FzZSBpbnQxNlRhZzogY2FzZSBpbnQzMlRhZzpcbiAgICBjYXNlIHVpbnQ4VGFnOiBjYXNlIHVpbnQ4Q2xhbXBlZFRhZzogY2FzZSB1aW50MTZUYWc6IGNhc2UgdWludDMyVGFnOlxuICAgICAgcmV0dXJuIGNsb25lVHlwZWRBcnJheShvYmplY3QsIGlzRGVlcCk7XG5cbiAgICBjYXNlIG1hcFRhZzpcbiAgICAgIHJldHVybiBjbG9uZU1hcChvYmplY3QsIGlzRGVlcCwgY2xvbmVGdW5jKTtcblxuICAgIGNhc2UgbnVtYmVyVGFnOlxuICAgIGNhc2Ugc3RyaW5nVGFnOlxuICAgICAgcmV0dXJuIG5ldyBDdG9yKG9iamVjdCk7XG5cbiAgICBjYXNlIHJlZ2V4cFRhZzpcbiAgICAgIHJldHVybiBjbG9uZVJlZ0V4cChvYmplY3QpO1xuXG4gICAgY2FzZSBzZXRUYWc6XG4gICAgICByZXR1cm4gY2xvbmVTZXQob2JqZWN0LCBpc0RlZXAsIGNsb25lRnVuYyk7XG5cbiAgICBjYXNlIHN5bWJvbFRhZzpcbiAgICAgIHJldHVybiBjbG9uZVN5bWJvbChvYmplY3QpO1xuICB9XG59XG5cbi8qKlxuICogQ2hlY2tzIGlmIGB2YWx1ZWAgaXMgYSB2YWxpZCBhcnJheS1saWtlIGluZGV4LlxuICpcbiAqIEBwcml2YXRlXG4gKiBAcGFyYW0geyp9IHZhbHVlIFRoZSB2YWx1ZSB0byBjaGVjay5cbiAqIEBwYXJhbSB7bnVtYmVyfSBbbGVuZ3RoPU1BWF9TQUZFX0lOVEVHRVJdIFRoZSB1cHBlciBib3VuZHMgb2YgYSB2YWxpZCBpbmRleC5cbiAqIEByZXR1cm5zIHtib29sZWFufSBSZXR1cm5zIGB0cnVlYCBpZiBgdmFsdWVgIGlzIGEgdmFsaWQgaW5kZXgsIGVsc2UgYGZhbHNlYC5cbiAqL1xuZnVuY3Rpb24gaXNJbmRleCh2YWx1ZSwgbGVuZ3RoKSB7XG4gIGxlbmd0aCA9IGxlbmd0aCA9PSBudWxsID8gTUFYX1NBRkVfSU5URUdFUiA6IGxlbmd0aDtcbiAgcmV0dXJuICEhbGVuZ3RoICYmXG4gICAgKHR5cGVvZiB2YWx1ZSA9PSAnbnVtYmVyJyB8fCByZUlzVWludC50ZXN0KHZhbHVlKSkgJiZcbiAgICAodmFsdWUgPiAtMSAmJiB2YWx1ZSAlIDEgPT0gMCAmJiB2YWx1ZSA8IGxlbmd0aCk7XG59XG5cbi8qKlxuICogQ2hlY2tzIGlmIGB2YWx1ZWAgaXMgc3VpdGFibGUgZm9yIHVzZSBhcyB1bmlxdWUgb2JqZWN0IGtleS5cbiAqXG4gKiBAcHJpdmF0ZVxuICogQHBhcmFtIHsqfSB2YWx1ZSBUaGUgdmFsdWUgdG8gY2hlY2suXG4gKiBAcmV0dXJucyB7Ym9vbGVhbn0gUmV0dXJucyBgdHJ1ZWAgaWYgYHZhbHVlYCBpcyBzdWl0YWJsZSwgZWxzZSBgZmFsc2VgLlxuICovXG5mdW5jdGlvbiBpc0tleWFibGUodmFsdWUpIHtcbiAgdmFyIHR5cGUgPSB0eXBlb2YgdmFsdWU7XG4gIHJldHVybiAodHlwZSA9PSAnc3RyaW5nJyB8fCB0eXBlID09ICdudW1iZXInIHx8IHR5cGUgPT0gJ3N5bWJvbCcgfHwgdHlwZSA9PSAnYm9vbGVhbicpXG4gICAgPyAodmFsdWUgIT09ICdfX3Byb3RvX18nKVxuICAgIDogKHZhbHVlID09PSBudWxsKTtcbn1cblxuLyoqXG4gKiBDaGVja3MgaWYgYGZ1bmNgIGhhcyBpdHMgc291cmNlIG1hc2tlZC5cbiAqXG4gKiBAcHJpdmF0ZVxuICogQHBhcmFtIHtGdW5jdGlvbn0gZnVuYyBUaGUgZnVuY3Rpb24gdG8gY2hlY2suXG4gKiBAcmV0dXJucyB7Ym9vbGVhbn0gUmV0dXJucyBgdHJ1ZWAgaWYgYGZ1bmNgIGlzIG1hc2tlZCwgZWxzZSBgZmFsc2VgLlxuICovXG5mdW5jdGlvbiBpc01hc2tlZChmdW5jKSB7XG4gIHJldHVybiAhIW1hc2tTcmNLZXkgJiYgKG1hc2tTcmNLZXkgaW4gZnVuYyk7XG59XG5cbi8qKlxuICogQ2hlY2tzIGlmIGB2YWx1ZWAgaXMgbGlrZWx5IGEgcHJvdG90eXBlIG9iamVjdC5cbiAqXG4gKiBAcHJpdmF0ZVxuICogQHBhcmFtIHsqfSB2YWx1ZSBUaGUgdmFsdWUgdG8gY2hlY2suXG4gKiBAcmV0dXJucyB7Ym9vbGVhbn0gUmV0dXJucyBgdHJ1ZWAgaWYgYHZhbHVlYCBpcyBhIHByb3RvdHlwZSwgZWxzZSBgZmFsc2VgLlxuICovXG5mdW5jdGlvbiBpc1Byb3RvdHlwZSh2YWx1ZSkge1xuICB2YXIgQ3RvciA9IHZhbHVlICYmIHZhbHVlLmNvbnN0cnVjdG9yLFxuICAgICAgcHJvdG8gPSAodHlwZW9mIEN0b3IgPT0gJ2Z1bmN0aW9uJyAmJiBDdG9yLnByb3RvdHlwZSkgfHwgb2JqZWN0UHJvdG87XG5cbiAgcmV0dXJuIHZhbHVlID09PSBwcm90bztcbn1cblxuLyoqXG4gKiBDb252ZXJ0cyBgZnVuY2AgdG8gaXRzIHNvdXJjZSBjb2RlLlxuICpcbiAqIEBwcml2YXRlXG4gKiBAcGFyYW0ge0Z1bmN0aW9ufSBmdW5jIFRoZSBmdW5jdGlvbiB0byBwcm9jZXNzLlxuICogQHJldHVybnMge3N0cmluZ30gUmV0dXJucyB0aGUgc291cmNlIGNvZGUuXG4gKi9cbmZ1bmN0aW9uIHRvU291cmNlKGZ1bmMpIHtcbiAgaWYgKGZ1bmMgIT0gbnVsbCkge1xuICAgIHRyeSB7XG4gICAgICByZXR1cm4gZnVuY1RvU3RyaW5nLmNhbGwoZnVuYyk7XG4gICAgfSBjYXRjaCAoZSkge31cbiAgICB0cnkge1xuICAgICAgcmV0dXJuIChmdW5jICsgJycpO1xuICAgIH0gY2F0Y2ggKGUpIHt9XG4gIH1cbiAgcmV0dXJuICcnO1xufVxuXG4vKipcbiAqIFRoaXMgbWV0aG9kIGlzIGxpa2UgYF8uY2xvbmVgIGV4Y2VwdCB0aGF0IGl0IHJlY3Vyc2l2ZWx5IGNsb25lcyBgdmFsdWVgLlxuICpcbiAqIEBzdGF0aWNcbiAqIEBtZW1iZXJPZiBfXG4gKiBAc2luY2UgMS4wLjBcbiAqIEBjYXRlZ29yeSBMYW5nXG4gKiBAcGFyYW0geyp9IHZhbHVlIFRoZSB2YWx1ZSB0byByZWN1cnNpdmVseSBjbG9uZS5cbiAqIEByZXR1cm5zIHsqfSBSZXR1cm5zIHRoZSBkZWVwIGNsb25lZCB2YWx1ZS5cbiAqIEBzZWUgXy5jbG9uZVxuICogQGV4YW1wbGVcbiAqXG4gKiB2YXIgb2JqZWN0cyA9IFt7ICdhJzogMSB9LCB7ICdiJzogMiB9XTtcbiAqXG4gKiB2YXIgZGVlcCA9IF8uY2xvbmVEZWVwKG9iamVjdHMpO1xuICogY29uc29sZS5sb2coZGVlcFswXSA9PT0gb2JqZWN0c1swXSk7XG4gKiAvLyA9PiBmYWxzZVxuICovXG5mdW5jdGlvbiBjbG9uZURlZXAodmFsdWUpIHtcbiAgcmV0dXJuIGJhc2VDbG9uZSh2YWx1ZSwgdHJ1ZSwgdHJ1ZSk7XG59XG5cbi8qKlxuICogUGVyZm9ybXMgYVxuICogW2BTYW1lVmFsdWVaZXJvYF0oaHR0cDovL2VjbWEtaW50ZXJuYXRpb25hbC5vcmcvZWNtYS0yNjIvNy4wLyNzZWMtc2FtZXZhbHVlemVybylcbiAqIGNvbXBhcmlzb24gYmV0d2VlbiB0d28gdmFsdWVzIHRvIGRldGVybWluZSBpZiB0aGV5IGFyZSBlcXVpdmFsZW50LlxuICpcbiAqIEBzdGF0aWNcbiAqIEBtZW1iZXJPZiBfXG4gKiBAc2luY2UgNC4wLjBcbiAqIEBjYXRlZ29yeSBMYW5nXG4gKiBAcGFyYW0geyp9IHZhbHVlIFRoZSB2YWx1ZSB0byBjb21wYXJlLlxuICogQHBhcmFtIHsqfSBvdGhlciBUaGUgb3RoZXIgdmFsdWUgdG8gY29tcGFyZS5cbiAqIEByZXR1cm5zIHtib29sZWFufSBSZXR1cm5zIGB0cnVlYCBpZiB0aGUgdmFsdWVzIGFyZSBlcXVpdmFsZW50LCBlbHNlIGBmYWxzZWAuXG4gKiBAZXhhbXBsZVxuICpcbiAqIHZhciBvYmplY3QgPSB7ICdhJzogMSB9O1xuICogdmFyIG90aGVyID0geyAnYSc6IDEgfTtcbiAqXG4gKiBfLmVxKG9iamVjdCwgb2JqZWN0KTtcbiAqIC8vID0+IHRydWVcbiAqXG4gKiBfLmVxKG9iamVjdCwgb3RoZXIpO1xuICogLy8gPT4gZmFsc2VcbiAqXG4gKiBfLmVxKCdhJywgJ2EnKTtcbiAqIC8vID0+IHRydWVcbiAqXG4gKiBfLmVxKCdhJywgT2JqZWN0KCdhJykpO1xuICogLy8gPT4gZmFsc2VcbiAqXG4gKiBfLmVxKE5hTiwgTmFOKTtcbiAqIC8vID0+IHRydWVcbiAqL1xuZnVuY3Rpb24gZXEodmFsdWUsIG90aGVyKSB7XG4gIHJldHVybiB2YWx1ZSA9PT0gb3RoZXIgfHwgKHZhbHVlICE9PSB2YWx1ZSAmJiBvdGhlciAhPT0gb3RoZXIpO1xufVxuXG4vKipcbiAqIENoZWNrcyBpZiBgdmFsdWVgIGlzIGxpa2VseSBhbiBgYXJndW1lbnRzYCBvYmplY3QuXG4gKlxuICogQHN0YXRpY1xuICogQG1lbWJlck9mIF9cbiAqIEBzaW5jZSAwLjEuMFxuICogQGNhdGVnb3J5IExhbmdcbiAqIEBwYXJhbSB7Kn0gdmFsdWUgVGhlIHZhbHVlIHRvIGNoZWNrLlxuICogQHJldHVybnMge2Jvb2xlYW59IFJldHVybnMgYHRydWVgIGlmIGB2YWx1ZWAgaXMgYW4gYGFyZ3VtZW50c2Agb2JqZWN0LFxuICogIGVsc2UgYGZhbHNlYC5cbiAqIEBleGFtcGxlXG4gKlxuICogXy5pc0FyZ3VtZW50cyhmdW5jdGlvbigpIHsgcmV0dXJuIGFyZ3VtZW50czsgfSgpKTtcbiAqIC8vID0+IHRydWVcbiAqXG4gKiBfLmlzQXJndW1lbnRzKFsxLCAyLCAzXSk7XG4gKiAvLyA9PiBmYWxzZVxuICovXG5mdW5jdGlvbiBpc0FyZ3VtZW50cyh2YWx1ZSkge1xuICAvLyBTYWZhcmkgOC4xIG1ha2VzIGBhcmd1bWVudHMuY2FsbGVlYCBlbnVtZXJhYmxlIGluIHN0cmljdCBtb2RlLlxuICByZXR1cm4gaXNBcnJheUxpa2VPYmplY3QodmFsdWUpICYmIGhhc093blByb3BlcnR5LmNhbGwodmFsdWUsICdjYWxsZWUnKSAmJlxuICAgICghcHJvcGVydHlJc0VudW1lcmFibGUuY2FsbCh2YWx1ZSwgJ2NhbGxlZScpIHx8IG9iamVjdFRvU3RyaW5nLmNhbGwodmFsdWUpID09IGFyZ3NUYWcpO1xufVxuXG4vKipcbiAqIENoZWNrcyBpZiBgdmFsdWVgIGlzIGNsYXNzaWZpZWQgYXMgYW4gYEFycmF5YCBvYmplY3QuXG4gKlxuICogQHN0YXRpY1xuICogQG1lbWJlck9mIF9cbiAqIEBzaW5jZSAwLjEuMFxuICogQGNhdGVnb3J5IExhbmdcbiAqIEBwYXJhbSB7Kn0gdmFsdWUgVGhlIHZhbHVlIHRvIGNoZWNrLlxuICogQHJldHVybnMge2Jvb2xlYW59IFJldHVybnMgYHRydWVgIGlmIGB2YWx1ZWAgaXMgYW4gYXJyYXksIGVsc2UgYGZhbHNlYC5cbiAqIEBleGFtcGxlXG4gKlxuICogXy5pc0FycmF5KFsxLCAyLCAzXSk7XG4gKiAvLyA9PiB0cnVlXG4gKlxuICogXy5pc0FycmF5KGRvY3VtZW50LmJvZHkuY2hpbGRyZW4pO1xuICogLy8gPT4gZmFsc2VcbiAqXG4gKiBfLmlzQXJyYXkoJ2FiYycpO1xuICogLy8gPT4gZmFsc2VcbiAqXG4gKiBfLmlzQXJyYXkoXy5ub29wKTtcbiAqIC8vID0+IGZhbHNlXG4gKi9cbnZhciBpc0FycmF5ID0gQXJyYXkuaXNBcnJheTtcblxuLyoqXG4gKiBDaGVja3MgaWYgYHZhbHVlYCBpcyBhcnJheS1saWtlLiBBIHZhbHVlIGlzIGNvbnNpZGVyZWQgYXJyYXktbGlrZSBpZiBpdCdzXG4gKiBub3QgYSBmdW5jdGlvbiBhbmQgaGFzIGEgYHZhbHVlLmxlbmd0aGAgdGhhdCdzIGFuIGludGVnZXIgZ3JlYXRlciB0aGFuIG9yXG4gKiBlcXVhbCB0byBgMGAgYW5kIGxlc3MgdGhhbiBvciBlcXVhbCB0byBgTnVtYmVyLk1BWF9TQUZFX0lOVEVHRVJgLlxuICpcbiAqIEBzdGF0aWNcbiAqIEBtZW1iZXJPZiBfXG4gKiBAc2luY2UgNC4wLjBcbiAqIEBjYXRlZ29yeSBMYW5nXG4gKiBAcGFyYW0geyp9IHZhbHVlIFRoZSB2YWx1ZSB0byBjaGVjay5cbiAqIEByZXR1cm5zIHtib29sZWFufSBSZXR1cm5zIGB0cnVlYCBpZiBgdmFsdWVgIGlzIGFycmF5LWxpa2UsIGVsc2UgYGZhbHNlYC5cbiAqIEBleGFtcGxlXG4gKlxuICogXy5pc0FycmF5TGlrZShbMSwgMiwgM10pO1xuICogLy8gPT4gdHJ1ZVxuICpcbiAqIF8uaXNBcnJheUxpa2UoZG9jdW1lbnQuYm9keS5jaGlsZHJlbik7XG4gKiAvLyA9PiB0cnVlXG4gKlxuICogXy5pc0FycmF5TGlrZSgnYWJjJyk7XG4gKiAvLyA9PiB0cnVlXG4gKlxuICogXy5pc0FycmF5TGlrZShfLm5vb3ApO1xuICogLy8gPT4gZmFsc2VcbiAqL1xuZnVuY3Rpb24gaXNBcnJheUxpa2UodmFsdWUpIHtcbiAgcmV0dXJuIHZhbHVlICE9IG51bGwgJiYgaXNMZW5ndGgodmFsdWUubGVuZ3RoKSAmJiAhaXNGdW5jdGlvbih2YWx1ZSk7XG59XG5cbi8qKlxuICogVGhpcyBtZXRob2QgaXMgbGlrZSBgXy5pc0FycmF5TGlrZWAgZXhjZXB0IHRoYXQgaXQgYWxzbyBjaGVja3MgaWYgYHZhbHVlYFxuICogaXMgYW4gb2JqZWN0LlxuICpcbiAqIEBzdGF0aWNcbiAqIEBtZW1iZXJPZiBfXG4gKiBAc2luY2UgNC4wLjBcbiAqIEBjYXRlZ29yeSBMYW5nXG4gKiBAcGFyYW0geyp9IHZhbHVlIFRoZSB2YWx1ZSB0byBjaGVjay5cbiAqIEByZXR1cm5zIHtib29sZWFufSBSZXR1cm5zIGB0cnVlYCBpZiBgdmFsdWVgIGlzIGFuIGFycmF5LWxpa2Ugb2JqZWN0LFxuICogIGVsc2UgYGZhbHNlYC5cbiAqIEBleGFtcGxlXG4gKlxuICogXy5pc0FycmF5TGlrZU9iamVjdChbMSwgMiwgM10pO1xuICogLy8gPT4gdHJ1ZVxuICpcbiAqIF8uaXNBcnJheUxpa2VPYmplY3QoZG9jdW1lbnQuYm9keS5jaGlsZHJlbik7XG4gKiAvLyA9PiB0cnVlXG4gKlxuICogXy5pc0FycmF5TGlrZU9iamVjdCgnYWJjJyk7XG4gKiAvLyA9PiBmYWxzZVxuICpcbiAqIF8uaXNBcnJheUxpa2VPYmplY3QoXy5ub29wKTtcbiAqIC8vID0+IGZhbHNlXG4gKi9cbmZ1bmN0aW9uIGlzQXJyYXlMaWtlT2JqZWN0KHZhbHVlKSB7XG4gIHJldHVybiBpc09iamVjdExpa2UodmFsdWUpICYmIGlzQXJyYXlMaWtlKHZhbHVlKTtcbn1cblxuLyoqXG4gKiBDaGVja3MgaWYgYHZhbHVlYCBpcyBhIGJ1ZmZlci5cbiAqXG4gKiBAc3RhdGljXG4gKiBAbWVtYmVyT2YgX1xuICogQHNpbmNlIDQuMy4wXG4gKiBAY2F0ZWdvcnkgTGFuZ1xuICogQHBhcmFtIHsqfSB2YWx1ZSBUaGUgdmFsdWUgdG8gY2hlY2suXG4gKiBAcmV0dXJucyB7Ym9vbGVhbn0gUmV0dXJucyBgdHJ1ZWAgaWYgYHZhbHVlYCBpcyBhIGJ1ZmZlciwgZWxzZSBgZmFsc2VgLlxuICogQGV4YW1wbGVcbiAqXG4gKiBfLmlzQnVmZmVyKG5ldyBCdWZmZXIoMikpO1xuICogLy8gPT4gdHJ1ZVxuICpcbiAqIF8uaXNCdWZmZXIobmV3IFVpbnQ4QXJyYXkoMikpO1xuICogLy8gPT4gZmFsc2VcbiAqL1xudmFyIGlzQnVmZmVyID0gbmF0aXZlSXNCdWZmZXIgfHwgc3R1YkZhbHNlO1xuXG4vKipcbiAqIENoZWNrcyBpZiBgdmFsdWVgIGlzIGNsYXNzaWZpZWQgYXMgYSBgRnVuY3Rpb25gIG9iamVjdC5cbiAqXG4gKiBAc3RhdGljXG4gKiBAbWVtYmVyT2YgX1xuICogQHNpbmNlIDAuMS4wXG4gKiBAY2F0ZWdvcnkgTGFuZ1xuICogQHBhcmFtIHsqfSB2YWx1ZSBUaGUgdmFsdWUgdG8gY2hlY2suXG4gKiBAcmV0dXJucyB7Ym9vbGVhbn0gUmV0dXJucyBgdHJ1ZWAgaWYgYHZhbHVlYCBpcyBhIGZ1bmN0aW9uLCBlbHNlIGBmYWxzZWAuXG4gKiBAZXhhbXBsZVxuICpcbiAqIF8uaXNGdW5jdGlvbihfKTtcbiAqIC8vID0+IHRydWVcbiAqXG4gKiBfLmlzRnVuY3Rpb24oL2FiYy8pO1xuICogLy8gPT4gZmFsc2VcbiAqL1xuZnVuY3Rpb24gaXNGdW5jdGlvbih2YWx1ZSkge1xuICAvLyBUaGUgdXNlIG9mIGBPYmplY3QjdG9TdHJpbmdgIGF2b2lkcyBpc3N1ZXMgd2l0aCB0aGUgYHR5cGVvZmAgb3BlcmF0b3JcbiAgLy8gaW4gU2FmYXJpIDgtOSB3aGljaCByZXR1cm5zICdvYmplY3QnIGZvciB0eXBlZCBhcnJheSBhbmQgb3RoZXIgY29uc3RydWN0b3JzLlxuICB2YXIgdGFnID0gaXNPYmplY3QodmFsdWUpID8gb2JqZWN0VG9TdHJpbmcuY2FsbCh2YWx1ZSkgOiAnJztcbiAgcmV0dXJuIHRhZyA9PSBmdW5jVGFnIHx8IHRhZyA9PSBnZW5UYWc7XG59XG5cbi8qKlxuICogQ2hlY2tzIGlmIGB2YWx1ZWAgaXMgYSB2YWxpZCBhcnJheS1saWtlIGxlbmd0aC5cbiAqXG4gKiAqKk5vdGU6KiogVGhpcyBtZXRob2QgaXMgbG9vc2VseSBiYXNlZCBvblxuICogW2BUb0xlbmd0aGBdKGh0dHA6Ly9lY21hLWludGVybmF0aW9uYWwub3JnL2VjbWEtMjYyLzcuMC8jc2VjLXRvbGVuZ3RoKS5cbiAqXG4gKiBAc3RhdGljXG4gKiBAbWVtYmVyT2YgX1xuICogQHNpbmNlIDQuMC4wXG4gKiBAY2F0ZWdvcnkgTGFuZ1xuICogQHBhcmFtIHsqfSB2YWx1ZSBUaGUgdmFsdWUgdG8gY2hlY2suXG4gKiBAcmV0dXJucyB7Ym9vbGVhbn0gUmV0dXJucyBgdHJ1ZWAgaWYgYHZhbHVlYCBpcyBhIHZhbGlkIGxlbmd0aCwgZWxzZSBgZmFsc2VgLlxuICogQGV4YW1wbGVcbiAqXG4gKiBfLmlzTGVuZ3RoKDMpO1xuICogLy8gPT4gdHJ1ZVxuICpcbiAqIF8uaXNMZW5ndGgoTnVtYmVyLk1JTl9WQUxVRSk7XG4gKiAvLyA9PiBmYWxzZVxuICpcbiAqIF8uaXNMZW5ndGgoSW5maW5pdHkpO1xuICogLy8gPT4gZmFsc2VcbiAqXG4gKiBfLmlzTGVuZ3RoKCczJyk7XG4gKiAvLyA9PiBmYWxzZVxuICovXG5mdW5jdGlvbiBpc0xlbmd0aCh2YWx1ZSkge1xuICByZXR1cm4gdHlwZW9mIHZhbHVlID09ICdudW1iZXInICYmXG4gICAgdmFsdWUgPiAtMSAmJiB2YWx1ZSAlIDEgPT0gMCAmJiB2YWx1ZSA8PSBNQVhfU0FGRV9JTlRFR0VSO1xufVxuXG4vKipcbiAqIENoZWNrcyBpZiBgdmFsdWVgIGlzIHRoZVxuICogW2xhbmd1YWdlIHR5cGVdKGh0dHA6Ly93d3cuZWNtYS1pbnRlcm5hdGlvbmFsLm9yZy9lY21hLTI2Mi83LjAvI3NlYy1lY21hc2NyaXB0LWxhbmd1YWdlLXR5cGVzKVxuICogb2YgYE9iamVjdGAuIChlLmcuIGFycmF5cywgZnVuY3Rpb25zLCBvYmplY3RzLCByZWdleGVzLCBgbmV3IE51bWJlcigwKWAsIGFuZCBgbmV3IFN0cmluZygnJylgKVxuICpcbiAqIEBzdGF0aWNcbiAqIEBtZW1iZXJPZiBfXG4gKiBAc2luY2UgMC4xLjBcbiAqIEBjYXRlZ29yeSBMYW5nXG4gKiBAcGFyYW0geyp9IHZhbHVlIFRoZSB2YWx1ZSB0byBjaGVjay5cbiAqIEByZXR1cm5zIHtib29sZWFufSBSZXR1cm5zIGB0cnVlYCBpZiBgdmFsdWVgIGlzIGFuIG9iamVjdCwgZWxzZSBgZmFsc2VgLlxuICogQGV4YW1wbGVcbiAqXG4gKiBfLmlzT2JqZWN0KHt9KTtcbiAqIC8vID0+IHRydWVcbiAqXG4gKiBfLmlzT2JqZWN0KFsxLCAyLCAzXSk7XG4gKiAvLyA9PiB0cnVlXG4gKlxuICogXy5pc09iamVjdChfLm5vb3ApO1xuICogLy8gPT4gdHJ1ZVxuICpcbiAqIF8uaXNPYmplY3QobnVsbCk7XG4gKiAvLyA9PiBmYWxzZVxuICovXG5mdW5jdGlvbiBpc09iamVjdCh2YWx1ZSkge1xuICB2YXIgdHlwZSA9IHR5cGVvZiB2YWx1ZTtcbiAgcmV0dXJuICEhdmFsdWUgJiYgKHR5cGUgPT0gJ29iamVjdCcgfHwgdHlwZSA9PSAnZnVuY3Rpb24nKTtcbn1cblxuLyoqXG4gKiBDaGVja3MgaWYgYHZhbHVlYCBpcyBvYmplY3QtbGlrZS4gQSB2YWx1ZSBpcyBvYmplY3QtbGlrZSBpZiBpdCdzIG5vdCBgbnVsbGBcbiAqIGFuZCBoYXMgYSBgdHlwZW9mYCByZXN1bHQgb2YgXCJvYmplY3RcIi5cbiAqXG4gKiBAc3RhdGljXG4gKiBAbWVtYmVyT2YgX1xuICogQHNpbmNlIDQuMC4wXG4gKiBAY2F0ZWdvcnkgTGFuZ1xuICogQHBhcmFtIHsqfSB2YWx1ZSBUaGUgdmFsdWUgdG8gY2hlY2suXG4gKiBAcmV0dXJucyB7Ym9vbGVhbn0gUmV0dXJucyBgdHJ1ZWAgaWYgYHZhbHVlYCBpcyBvYmplY3QtbGlrZSwgZWxzZSBgZmFsc2VgLlxuICogQGV4YW1wbGVcbiAqXG4gKiBfLmlzT2JqZWN0TGlrZSh7fSk7XG4gKiAvLyA9PiB0cnVlXG4gKlxuICogXy5pc09iamVjdExpa2UoWzEsIDIsIDNdKTtcbiAqIC8vID0+IHRydWVcbiAqXG4gKiBfLmlzT2JqZWN0TGlrZShfLm5vb3ApO1xuICogLy8gPT4gZmFsc2VcbiAqXG4gKiBfLmlzT2JqZWN0TGlrZShudWxsKTtcbiAqIC8vID0+IGZhbHNlXG4gKi9cbmZ1bmN0aW9uIGlzT2JqZWN0TGlrZSh2YWx1ZSkge1xuICByZXR1cm4gISF2YWx1ZSAmJiB0eXBlb2YgdmFsdWUgPT0gJ29iamVjdCc7XG59XG5cbi8qKlxuICogQ3JlYXRlcyBhbiBhcnJheSBvZiB0aGUgb3duIGVudW1lcmFibGUgcHJvcGVydHkgbmFtZXMgb2YgYG9iamVjdGAuXG4gKlxuICogKipOb3RlOioqIE5vbi1vYmplY3QgdmFsdWVzIGFyZSBjb2VyY2VkIHRvIG9iamVjdHMuIFNlZSB0aGVcbiAqIFtFUyBzcGVjXShodHRwOi8vZWNtYS1pbnRlcm5hdGlvbmFsLm9yZy9lY21hLTI2Mi83LjAvI3NlYy1vYmplY3Qua2V5cylcbiAqIGZvciBtb3JlIGRldGFpbHMuXG4gKlxuICogQHN0YXRpY1xuICogQHNpbmNlIDAuMS4wXG4gKiBAbWVtYmVyT2YgX1xuICogQGNhdGVnb3J5IE9iamVjdFxuICogQHBhcmFtIHtPYmplY3R9IG9iamVjdCBUaGUgb2JqZWN0IHRvIHF1ZXJ5LlxuICogQHJldHVybnMge0FycmF5fSBSZXR1cm5zIHRoZSBhcnJheSBvZiBwcm9wZXJ0eSBuYW1lcy5cbiAqIEBleGFtcGxlXG4gKlxuICogZnVuY3Rpb24gRm9vKCkge1xuICogICB0aGlzLmEgPSAxO1xuICogICB0aGlzLmIgPSAyO1xuICogfVxuICpcbiAqIEZvby5wcm90b3R5cGUuYyA9IDM7XG4gKlxuICogXy5rZXlzKG5ldyBGb28pO1xuICogLy8gPT4gWydhJywgJ2InXSAoaXRlcmF0aW9uIG9yZGVyIGlzIG5vdCBndWFyYW50ZWVkKVxuICpcbiAqIF8ua2V5cygnaGknKTtcbiAqIC8vID0+IFsnMCcsICcxJ11cbiAqL1xuZnVuY3Rpb24ga2V5cyhvYmplY3QpIHtcbiAgcmV0dXJuIGlzQXJyYXlMaWtlKG9iamVjdCkgPyBhcnJheUxpa2VLZXlzKG9iamVjdCkgOiBiYXNlS2V5cyhvYmplY3QpO1xufVxuXG4vKipcbiAqIFRoaXMgbWV0aG9kIHJldHVybnMgYSBuZXcgZW1wdHkgYXJyYXkuXG4gKlxuICogQHN0YXRpY1xuICogQG1lbWJlck9mIF9cbiAqIEBzaW5jZSA0LjEzLjBcbiAqIEBjYXRlZ29yeSBVdGlsXG4gKiBAcmV0dXJucyB7QXJyYXl9IFJldHVybnMgdGhlIG5ldyBlbXB0eSBhcnJheS5cbiAqIEBleGFtcGxlXG4gKlxuICogdmFyIGFycmF5cyA9IF8udGltZXMoMiwgXy5zdHViQXJyYXkpO1xuICpcbiAqIGNvbnNvbGUubG9nKGFycmF5cyk7XG4gKiAvLyA9PiBbW10sIFtdXVxuICpcbiAqIGNvbnNvbGUubG9nKGFycmF5c1swXSA9PT0gYXJyYXlzWzFdKTtcbiAqIC8vID0+IGZhbHNlXG4gKi9cbmZ1bmN0aW9uIHN0dWJBcnJheSgpIHtcbiAgcmV0dXJuIFtdO1xufVxuXG4vKipcbiAqIFRoaXMgbWV0aG9kIHJldHVybnMgYGZhbHNlYC5cbiAqXG4gKiBAc3RhdGljXG4gKiBAbWVtYmVyT2YgX1xuICogQHNpbmNlIDQuMTMuMFxuICogQGNhdGVnb3J5IFV0aWxcbiAqIEByZXR1cm5zIHtib29sZWFufSBSZXR1cm5zIGBmYWxzZWAuXG4gKiBAZXhhbXBsZVxuICpcbiAqIF8udGltZXMoMiwgXy5zdHViRmFsc2UpO1xuICogLy8gPT4gW2ZhbHNlLCBmYWxzZV1cbiAqL1xuZnVuY3Rpb24gc3R1YkZhbHNlKCkge1xuICByZXR1cm4gZmFsc2U7XG59XG5cbm1vZHVsZS5leHBvcnRzID0gY2xvbmVEZWVwO1xuIiwiLyoqXG4gKiBMb2Rhc2ggKEN1c3RvbSBCdWlsZCkgPGh0dHBzOi8vbG9kYXNoLmNvbS8+XG4gKiBCdWlsZDogYGxvZGFzaCBtb2R1bGFyaXplIGV4cG9ydHM9XCJucG1cIiAtbyAuL2BcbiAqIENvcHlyaWdodCBKUyBGb3VuZGF0aW9uIGFuZCBvdGhlciBjb250cmlidXRvcnMgPGh0dHBzOi8vanMuZm91bmRhdGlvbi8+XG4gKiBSZWxlYXNlZCB1bmRlciBNSVQgbGljZW5zZSA8aHR0cHM6Ly9sb2Rhc2guY29tL2xpY2Vuc2U+XG4gKiBCYXNlZCBvbiBVbmRlcnNjb3JlLmpzIDEuOC4zIDxodHRwOi8vdW5kZXJzY29yZWpzLm9yZy9MSUNFTlNFPlxuICogQ29weXJpZ2h0IEplcmVteSBBc2hrZW5hcywgRG9jdW1lbnRDbG91ZCBhbmQgSW52ZXN0aWdhdGl2ZSBSZXBvcnRlcnMgJiBFZGl0b3JzXG4gKi9cblxuLyoqIFVzZWQgYXMgdGhlIHNpemUgdG8gZW5hYmxlIGxhcmdlIGFycmF5IG9wdGltaXphdGlvbnMuICovXG52YXIgTEFSR0VfQVJSQVlfU0laRSA9IDIwMDtcblxuLyoqIFVzZWQgdG8gc3RhbmQtaW4gZm9yIGB1bmRlZmluZWRgIGhhc2ggdmFsdWVzLiAqL1xudmFyIEhBU0hfVU5ERUZJTkVEID0gJ19fbG9kYXNoX2hhc2hfdW5kZWZpbmVkX18nO1xuXG4vKiogVXNlZCB0byBjb21wb3NlIGJpdG1hc2tzIGZvciB2YWx1ZSBjb21wYXJpc29ucy4gKi9cbnZhciBDT01QQVJFX1BBUlRJQUxfRkxBRyA9IDEsXG4gICAgQ09NUEFSRV9VTk9SREVSRURfRkxBRyA9IDI7XG5cbi8qKiBVc2VkIGFzIHJlZmVyZW5jZXMgZm9yIHZhcmlvdXMgYE51bWJlcmAgY29uc3RhbnRzLiAqL1xudmFyIE1BWF9TQUZFX0lOVEVHRVIgPSA5MDA3MTk5MjU0NzQwOTkxO1xuXG4vKiogYE9iamVjdCN0b1N0cmluZ2AgcmVzdWx0IHJlZmVyZW5jZXMuICovXG52YXIgYXJnc1RhZyA9ICdbb2JqZWN0IEFyZ3VtZW50c10nLFxuICAgIGFycmF5VGFnID0gJ1tvYmplY3QgQXJyYXldJyxcbiAgICBhc3luY1RhZyA9ICdbb2JqZWN0IEFzeW5jRnVuY3Rpb25dJyxcbiAgICBib29sVGFnID0gJ1tvYmplY3QgQm9vbGVhbl0nLFxuICAgIGRhdGVUYWcgPSAnW29iamVjdCBEYXRlXScsXG4gICAgZXJyb3JUYWcgPSAnW29iamVjdCBFcnJvcl0nLFxuICAgIGZ1bmNUYWcgPSAnW29iamVjdCBGdW5jdGlvbl0nLFxuICAgIGdlblRhZyA9ICdbb2JqZWN0IEdlbmVyYXRvckZ1bmN0aW9uXScsXG4gICAgbWFwVGFnID0gJ1tvYmplY3QgTWFwXScsXG4gICAgbnVtYmVyVGFnID0gJ1tvYmplY3QgTnVtYmVyXScsXG4gICAgbnVsbFRhZyA9ICdbb2JqZWN0IE51bGxdJyxcbiAgICBvYmplY3RUYWcgPSAnW29iamVjdCBPYmplY3RdJyxcbiAgICBwcm9taXNlVGFnID0gJ1tvYmplY3QgUHJvbWlzZV0nLFxuICAgIHByb3h5VGFnID0gJ1tvYmplY3QgUHJveHldJyxcbiAgICByZWdleHBUYWcgPSAnW29iamVjdCBSZWdFeHBdJyxcbiAgICBzZXRUYWcgPSAnW29iamVjdCBTZXRdJyxcbiAgICBzdHJpbmdUYWcgPSAnW29iamVjdCBTdHJpbmddJyxcbiAgICBzeW1ib2xUYWcgPSAnW29iamVjdCBTeW1ib2xdJyxcbiAgICB1bmRlZmluZWRUYWcgPSAnW29iamVjdCBVbmRlZmluZWRdJyxcbiAgICB3ZWFrTWFwVGFnID0gJ1tvYmplY3QgV2Vha01hcF0nO1xuXG52YXIgYXJyYXlCdWZmZXJUYWcgPSAnW29iamVjdCBBcnJheUJ1ZmZlcl0nLFxuICAgIGRhdGFWaWV3VGFnID0gJ1tvYmplY3QgRGF0YVZpZXddJyxcbiAgICBmbG9hdDMyVGFnID0gJ1tvYmplY3QgRmxvYXQzMkFycmF5XScsXG4gICAgZmxvYXQ2NFRhZyA9ICdbb2JqZWN0IEZsb2F0NjRBcnJheV0nLFxuICAgIGludDhUYWcgPSAnW29iamVjdCBJbnQ4QXJyYXldJyxcbiAgICBpbnQxNlRhZyA9ICdbb2JqZWN0IEludDE2QXJyYXldJyxcbiAgICBpbnQzMlRhZyA9ICdbb2JqZWN0IEludDMyQXJyYXldJyxcbiAgICB1aW50OFRhZyA9ICdbb2JqZWN0IFVpbnQ4QXJyYXldJyxcbiAgICB1aW50OENsYW1wZWRUYWcgPSAnW29iamVjdCBVaW50OENsYW1wZWRBcnJheV0nLFxuICAgIHVpbnQxNlRhZyA9ICdbb2JqZWN0IFVpbnQxNkFycmF5XScsXG4gICAgdWludDMyVGFnID0gJ1tvYmplY3QgVWludDMyQXJyYXldJztcblxuLyoqXG4gKiBVc2VkIHRvIG1hdGNoIGBSZWdFeHBgXG4gKiBbc3ludGF4IGNoYXJhY3RlcnNdKGh0dHA6Ly9lY21hLWludGVybmF0aW9uYWwub3JnL2VjbWEtMjYyLzcuMC8jc2VjLXBhdHRlcm5zKS5cbiAqL1xudmFyIHJlUmVnRXhwQ2hhciA9IC9bXFxcXF4kLiorPygpW1xcXXt9fF0vZztcblxuLyoqIFVzZWQgdG8gZGV0ZWN0IGhvc3QgY29uc3RydWN0b3JzIChTYWZhcmkpLiAqL1xudmFyIHJlSXNIb3N0Q3RvciA9IC9eXFxbb2JqZWN0IC4rP0NvbnN0cnVjdG9yXFxdJC87XG5cbi8qKiBVc2VkIHRvIGRldGVjdCB1bnNpZ25lZCBpbnRlZ2VyIHZhbHVlcy4gKi9cbnZhciByZUlzVWludCA9IC9eKD86MHxbMS05XVxcZCopJC87XG5cbi8qKiBVc2VkIHRvIGlkZW50aWZ5IGB0b1N0cmluZ1RhZ2AgdmFsdWVzIG9mIHR5cGVkIGFycmF5cy4gKi9cbnZhciB0eXBlZEFycmF5VGFncyA9IHt9O1xudHlwZWRBcnJheVRhZ3NbZmxvYXQzMlRhZ10gPSB0eXBlZEFycmF5VGFnc1tmbG9hdDY0VGFnXSA9XG50eXBlZEFycmF5VGFnc1tpbnQ4VGFnXSA9IHR5cGVkQXJyYXlUYWdzW2ludDE2VGFnXSA9XG50eXBlZEFycmF5VGFnc1tpbnQzMlRhZ10gPSB0eXBlZEFycmF5VGFnc1t1aW50OFRhZ10gPVxudHlwZWRBcnJheVRhZ3NbdWludDhDbGFtcGVkVGFnXSA9IHR5cGVkQXJyYXlUYWdzW3VpbnQxNlRhZ10gPVxudHlwZWRBcnJheVRhZ3NbdWludDMyVGFnXSA9IHRydWU7XG50eXBlZEFycmF5VGFnc1thcmdzVGFnXSA9IHR5cGVkQXJyYXlUYWdzW2FycmF5VGFnXSA9XG50eXBlZEFycmF5VGFnc1thcnJheUJ1ZmZlclRhZ10gPSB0eXBlZEFycmF5VGFnc1tib29sVGFnXSA9XG50eXBlZEFycmF5VGFnc1tkYXRhVmlld1RhZ10gPSB0eXBlZEFycmF5VGFnc1tkYXRlVGFnXSA9XG50eXBlZEFycmF5VGFnc1tlcnJvclRhZ10gPSB0eXBlZEFycmF5VGFnc1tmdW5jVGFnXSA9XG50eXBlZEFycmF5VGFnc1ttYXBUYWddID0gdHlwZWRBcnJheVRhZ3NbbnVtYmVyVGFnXSA9XG50eXBlZEFycmF5VGFnc1tvYmplY3RUYWddID0gdHlwZWRBcnJheVRhZ3NbcmVnZXhwVGFnXSA9XG50eXBlZEFycmF5VGFnc1tzZXRUYWddID0gdHlwZWRBcnJheVRhZ3Nbc3RyaW5nVGFnXSA9XG50eXBlZEFycmF5VGFnc1t3ZWFrTWFwVGFnXSA9IGZhbHNlO1xuXG4vKiogRGV0ZWN0IGZyZWUgdmFyaWFibGUgYGdsb2JhbGAgZnJvbSBOb2RlLmpzLiAqL1xudmFyIGZyZWVHbG9iYWwgPSB0eXBlb2YgZ2xvYmFsID09ICdvYmplY3QnICYmIGdsb2JhbCAmJiBnbG9iYWwuT2JqZWN0ID09PSBPYmplY3QgJiYgZ2xvYmFsO1xuXG4vKiogRGV0ZWN0IGZyZWUgdmFyaWFibGUgYHNlbGZgLiAqL1xudmFyIGZyZWVTZWxmID0gdHlwZW9mIHNlbGYgPT0gJ29iamVjdCcgJiYgc2VsZiAmJiBzZWxmLk9iamVjdCA9PT0gT2JqZWN0ICYmIHNlbGY7XG5cbi8qKiBVc2VkIGFzIGEgcmVmZXJlbmNlIHRvIHRoZSBnbG9iYWwgb2JqZWN0LiAqL1xudmFyIHJvb3QgPSBmcmVlR2xvYmFsIHx8IGZyZWVTZWxmIHx8IEZ1bmN0aW9uKCdyZXR1cm4gdGhpcycpKCk7XG5cbi8qKiBEZXRlY3QgZnJlZSB2YXJpYWJsZSBgZXhwb3J0c2AuICovXG52YXIgZnJlZUV4cG9ydHMgPSB0eXBlb2YgZXhwb3J0cyA9PSAnb2JqZWN0JyAmJiBleHBvcnRzICYmICFleHBvcnRzLm5vZGVUeXBlICYmIGV4cG9ydHM7XG5cbi8qKiBEZXRlY3QgZnJlZSB2YXJpYWJsZSBgbW9kdWxlYC4gKi9cbnZhciBmcmVlTW9kdWxlID0gZnJlZUV4cG9ydHMgJiYgdHlwZW9mIG1vZHVsZSA9PSAnb2JqZWN0JyAmJiBtb2R1bGUgJiYgIW1vZHVsZS5ub2RlVHlwZSAmJiBtb2R1bGU7XG5cbi8qKiBEZXRlY3QgdGhlIHBvcHVsYXIgQ29tbW9uSlMgZXh0ZW5zaW9uIGBtb2R1bGUuZXhwb3J0c2AuICovXG52YXIgbW9kdWxlRXhwb3J0cyA9IGZyZWVNb2R1bGUgJiYgZnJlZU1vZHVsZS5leHBvcnRzID09PSBmcmVlRXhwb3J0cztcblxuLyoqIERldGVjdCBmcmVlIHZhcmlhYmxlIGBwcm9jZXNzYCBmcm9tIE5vZGUuanMuICovXG52YXIgZnJlZVByb2Nlc3MgPSBtb2R1bGVFeHBvcnRzICYmIGZyZWVHbG9iYWwucHJvY2VzcztcblxuLyoqIFVzZWQgdG8gYWNjZXNzIGZhc3RlciBOb2RlLmpzIGhlbHBlcnMuICovXG52YXIgbm9kZVV0aWwgPSAoZnVuY3Rpb24oKSB7XG4gIHRyeSB7XG4gICAgcmV0dXJuIGZyZWVQcm9jZXNzICYmIGZyZWVQcm9jZXNzLmJpbmRpbmcgJiYgZnJlZVByb2Nlc3MuYmluZGluZygndXRpbCcpO1xuICB9IGNhdGNoIChlKSB7fVxufSgpKTtcblxuLyogTm9kZS5qcyBoZWxwZXIgcmVmZXJlbmNlcy4gKi9cbnZhciBub2RlSXNUeXBlZEFycmF5ID0gbm9kZVV0aWwgJiYgbm9kZVV0aWwuaXNUeXBlZEFycmF5O1xuXG4vKipcbiAqIEEgc3BlY2lhbGl6ZWQgdmVyc2lvbiBvZiBgXy5maWx0ZXJgIGZvciBhcnJheXMgd2l0aG91dCBzdXBwb3J0IGZvclxuICogaXRlcmF0ZWUgc2hvcnRoYW5kcy5cbiAqXG4gKiBAcHJpdmF0ZVxuICogQHBhcmFtIHtBcnJheX0gW2FycmF5XSBUaGUgYXJyYXkgdG8gaXRlcmF0ZSBvdmVyLlxuICogQHBhcmFtIHtGdW5jdGlvbn0gcHJlZGljYXRlIFRoZSBmdW5jdGlvbiBpbnZva2VkIHBlciBpdGVyYXRpb24uXG4gKiBAcmV0dXJucyB7QXJyYXl9IFJldHVybnMgdGhlIG5ldyBmaWx0ZXJlZCBhcnJheS5cbiAqL1xuZnVuY3Rpb24gYXJyYXlGaWx0ZXIoYXJyYXksIHByZWRpY2F0ZSkge1xuICB2YXIgaW5kZXggPSAtMSxcbiAgICAgIGxlbmd0aCA9IGFycmF5ID09IG51bGwgPyAwIDogYXJyYXkubGVuZ3RoLFxuICAgICAgcmVzSW5kZXggPSAwLFxuICAgICAgcmVzdWx0ID0gW107XG5cbiAgd2hpbGUgKCsraW5kZXggPCBsZW5ndGgpIHtcbiAgICB2YXIgdmFsdWUgPSBhcnJheVtpbmRleF07XG4gICAgaWYgKHByZWRpY2F0ZSh2YWx1ZSwgaW5kZXgsIGFycmF5KSkge1xuICAgICAgcmVzdWx0W3Jlc0luZGV4KytdID0gdmFsdWU7XG4gICAgfVxuICB9XG4gIHJldHVybiByZXN1bHQ7XG59XG5cbi8qKlxuICogQXBwZW5kcyB0aGUgZWxlbWVudHMgb2YgYHZhbHVlc2AgdG8gYGFycmF5YC5cbiAqXG4gKiBAcHJpdmF0ZVxuICogQHBhcmFtIHtBcnJheX0gYXJyYXkgVGhlIGFycmF5IHRvIG1vZGlmeS5cbiAqIEBwYXJhbSB7QXJyYXl9IHZhbHVlcyBUaGUgdmFsdWVzIHRvIGFwcGVuZC5cbiAqIEByZXR1cm5zIHtBcnJheX0gUmV0dXJucyBgYXJyYXlgLlxuICovXG5mdW5jdGlvbiBhcnJheVB1c2goYXJyYXksIHZhbHVlcykge1xuICB2YXIgaW5kZXggPSAtMSxcbiAgICAgIGxlbmd0aCA9IHZhbHVlcy5sZW5ndGgsXG4gICAgICBvZmZzZXQgPSBhcnJheS5sZW5ndGg7XG5cbiAgd2hpbGUgKCsraW5kZXggPCBsZW5ndGgpIHtcbiAgICBhcnJheVtvZmZzZXQgKyBpbmRleF0gPSB2YWx1ZXNbaW5kZXhdO1xuICB9XG4gIHJldHVybiBhcnJheTtcbn1cblxuLyoqXG4gKiBBIHNwZWNpYWxpemVkIHZlcnNpb24gb2YgYF8uc29tZWAgZm9yIGFycmF5cyB3aXRob3V0IHN1cHBvcnQgZm9yIGl0ZXJhdGVlXG4gKiBzaG9ydGhhbmRzLlxuICpcbiAqIEBwcml2YXRlXG4gKiBAcGFyYW0ge0FycmF5fSBbYXJyYXldIFRoZSBhcnJheSB0byBpdGVyYXRlIG92ZXIuXG4gKiBAcGFyYW0ge0Z1bmN0aW9ufSBwcmVkaWNhdGUgVGhlIGZ1bmN0aW9uIGludm9rZWQgcGVyIGl0ZXJhdGlvbi5cbiAqIEByZXR1cm5zIHtib29sZWFufSBSZXR1cm5zIGB0cnVlYCBpZiBhbnkgZWxlbWVudCBwYXNzZXMgdGhlIHByZWRpY2F0ZSBjaGVjayxcbiAqICBlbHNlIGBmYWxzZWAuXG4gKi9cbmZ1bmN0aW9uIGFycmF5U29tZShhcnJheSwgcHJlZGljYXRlKSB7XG4gIHZhciBpbmRleCA9IC0xLFxuICAgICAgbGVuZ3RoID0gYXJyYXkgPT0gbnVsbCA/IDAgOiBhcnJheS5sZW5ndGg7XG5cbiAgd2hpbGUgKCsraW5kZXggPCBsZW5ndGgpIHtcbiAgICBpZiAocHJlZGljYXRlKGFycmF5W2luZGV4XSwgaW5kZXgsIGFycmF5KSkge1xuICAgICAgcmV0dXJuIHRydWU7XG4gICAgfVxuICB9XG4gIHJldHVybiBmYWxzZTtcbn1cblxuLyoqXG4gKiBUaGUgYmFzZSBpbXBsZW1lbnRhdGlvbiBvZiBgXy50aW1lc2Agd2l0aG91dCBzdXBwb3J0IGZvciBpdGVyYXRlZSBzaG9ydGhhbmRzXG4gKiBvciBtYXggYXJyYXkgbGVuZ3RoIGNoZWNrcy5cbiAqXG4gKiBAcHJpdmF0ZVxuICogQHBhcmFtIHtudW1iZXJ9IG4gVGhlIG51bWJlciBvZiB0aW1lcyB0byBpbnZva2UgYGl0ZXJhdGVlYC5cbiAqIEBwYXJhbSB7RnVuY3Rpb259IGl0ZXJhdGVlIFRoZSBmdW5jdGlvbiBpbnZva2VkIHBlciBpdGVyYXRpb24uXG4gKiBAcmV0dXJucyB7QXJyYXl9IFJldHVybnMgdGhlIGFycmF5IG9mIHJlc3VsdHMuXG4gKi9cbmZ1bmN0aW9uIGJhc2VUaW1lcyhuLCBpdGVyYXRlZSkge1xuICB2YXIgaW5kZXggPSAtMSxcbiAgICAgIHJlc3VsdCA9IEFycmF5KG4pO1xuXG4gIHdoaWxlICgrK2luZGV4IDwgbikge1xuICAgIHJlc3VsdFtpbmRleF0gPSBpdGVyYXRlZShpbmRleCk7XG4gIH1cbiAgcmV0dXJuIHJlc3VsdDtcbn1cblxuLyoqXG4gKiBUaGUgYmFzZSBpbXBsZW1lbnRhdGlvbiBvZiBgXy51bmFyeWAgd2l0aG91dCBzdXBwb3J0IGZvciBzdG9yaW5nIG1ldGFkYXRhLlxuICpcbiAqIEBwcml2YXRlXG4gKiBAcGFyYW0ge0Z1bmN0aW9ufSBmdW5jIFRoZSBmdW5jdGlvbiB0byBjYXAgYXJndW1lbnRzIGZvci5cbiAqIEByZXR1cm5zIHtGdW5jdGlvbn0gUmV0dXJucyB0aGUgbmV3IGNhcHBlZCBmdW5jdGlvbi5cbiAqL1xuZnVuY3Rpb24gYmFzZVVuYXJ5KGZ1bmMpIHtcbiAgcmV0dXJuIGZ1bmN0aW9uKHZhbHVlKSB7XG4gICAgcmV0dXJuIGZ1bmModmFsdWUpO1xuICB9O1xufVxuXG4vKipcbiAqIENoZWNrcyBpZiBhIGBjYWNoZWAgdmFsdWUgZm9yIGBrZXlgIGV4aXN0cy5cbiAqXG4gKiBAcHJpdmF0ZVxuICogQHBhcmFtIHtPYmplY3R9IGNhY2hlIFRoZSBjYWNoZSB0byBxdWVyeS5cbiAqIEBwYXJhbSB7c3RyaW5nfSBrZXkgVGhlIGtleSBvZiB0aGUgZW50cnkgdG8gY2hlY2suXG4gKiBAcmV0dXJucyB7Ym9vbGVhbn0gUmV0dXJucyBgdHJ1ZWAgaWYgYW4gZW50cnkgZm9yIGBrZXlgIGV4aXN0cywgZWxzZSBgZmFsc2VgLlxuICovXG5mdW5jdGlvbiBjYWNoZUhhcyhjYWNoZSwga2V5KSB7XG4gIHJldHVybiBjYWNoZS5oYXMoa2V5KTtcbn1cblxuLyoqXG4gKiBHZXRzIHRoZSB2YWx1ZSBhdCBga2V5YCBvZiBgb2JqZWN0YC5cbiAqXG4gKiBAcHJpdmF0ZVxuICogQHBhcmFtIHtPYmplY3R9IFtvYmplY3RdIFRoZSBvYmplY3QgdG8gcXVlcnkuXG4gKiBAcGFyYW0ge3N0cmluZ30ga2V5IFRoZSBrZXkgb2YgdGhlIHByb3BlcnR5IHRvIGdldC5cbiAqIEByZXR1cm5zIHsqfSBSZXR1cm5zIHRoZSBwcm9wZXJ0eSB2YWx1ZS5cbiAqL1xuZnVuY3Rpb24gZ2V0VmFsdWUob2JqZWN0LCBrZXkpIHtcbiAgcmV0dXJuIG9iamVjdCA9PSBudWxsID8gdW5kZWZpbmVkIDogb2JqZWN0W2tleV07XG59XG5cbi8qKlxuICogQ29udmVydHMgYG1hcGAgdG8gaXRzIGtleS12YWx1ZSBwYWlycy5cbiAqXG4gKiBAcHJpdmF0ZVxuICogQHBhcmFtIHtPYmplY3R9IG1hcCBUaGUgbWFwIHRvIGNvbnZlcnQuXG4gKiBAcmV0dXJucyB7QXJyYXl9IFJldHVybnMgdGhlIGtleS12YWx1ZSBwYWlycy5cbiAqL1xuZnVuY3Rpb24gbWFwVG9BcnJheShtYXApIHtcbiAgdmFyIGluZGV4ID0gLTEsXG4gICAgICByZXN1bHQgPSBBcnJheShtYXAuc2l6ZSk7XG5cbiAgbWFwLmZvckVhY2goZnVuY3Rpb24odmFsdWUsIGtleSkge1xuICAgIHJlc3VsdFsrK2luZGV4XSA9IFtrZXksIHZhbHVlXTtcbiAgfSk7XG4gIHJldHVybiByZXN1bHQ7XG59XG5cbi8qKlxuICogQ3JlYXRlcyBhIHVuYXJ5IGZ1bmN0aW9uIHRoYXQgaW52b2tlcyBgZnVuY2Agd2l0aCBpdHMgYXJndW1lbnQgdHJhbnNmb3JtZWQuXG4gKlxuICogQHByaXZhdGVcbiAqIEBwYXJhbSB7RnVuY3Rpb259IGZ1bmMgVGhlIGZ1bmN0aW9uIHRvIHdyYXAuXG4gKiBAcGFyYW0ge0Z1bmN0aW9ufSB0cmFuc2Zvcm0gVGhlIGFyZ3VtZW50IHRyYW5zZm9ybS5cbiAqIEByZXR1cm5zIHtGdW5jdGlvbn0gUmV0dXJucyB0aGUgbmV3IGZ1bmN0aW9uLlxuICovXG5mdW5jdGlvbiBvdmVyQXJnKGZ1bmMsIHRyYW5zZm9ybSkge1xuICByZXR1cm4gZnVuY3Rpb24oYXJnKSB7XG4gICAgcmV0dXJuIGZ1bmModHJhbnNmb3JtKGFyZykpO1xuICB9O1xufVxuXG4vKipcbiAqIENvbnZlcnRzIGBzZXRgIHRvIGFuIGFycmF5IG9mIGl0cyB2YWx1ZXMuXG4gKlxuICogQHByaXZhdGVcbiAqIEBwYXJhbSB7T2JqZWN0fSBzZXQgVGhlIHNldCB0byBjb252ZXJ0LlxuICogQHJldHVybnMge0FycmF5fSBSZXR1cm5zIHRoZSB2YWx1ZXMuXG4gKi9cbmZ1bmN0aW9uIHNldFRvQXJyYXkoc2V0KSB7XG4gIHZhciBpbmRleCA9IC0xLFxuICAgICAgcmVzdWx0ID0gQXJyYXkoc2V0LnNpemUpO1xuXG4gIHNldC5mb3JFYWNoKGZ1bmN0aW9uKHZhbHVlKSB7XG4gICAgcmVzdWx0WysraW5kZXhdID0gdmFsdWU7XG4gIH0pO1xuICByZXR1cm4gcmVzdWx0O1xufVxuXG4vKiogVXNlZCBmb3IgYnVpbHQtaW4gbWV0aG9kIHJlZmVyZW5jZXMuICovXG52YXIgYXJyYXlQcm90byA9IEFycmF5LnByb3RvdHlwZSxcbiAgICBmdW5jUHJvdG8gPSBGdW5jdGlvbi5wcm90b3R5cGUsXG4gICAgb2JqZWN0UHJvdG8gPSBPYmplY3QucHJvdG90eXBlO1xuXG4vKiogVXNlZCB0byBkZXRlY3Qgb3ZlcnJlYWNoaW5nIGNvcmUtanMgc2hpbXMuICovXG52YXIgY29yZUpzRGF0YSA9IHJvb3RbJ19fY29yZS1qc19zaGFyZWRfXyddO1xuXG4vKiogVXNlZCB0byByZXNvbHZlIHRoZSBkZWNvbXBpbGVkIHNvdXJjZSBvZiBmdW5jdGlvbnMuICovXG52YXIgZnVuY1RvU3RyaW5nID0gZnVuY1Byb3RvLnRvU3RyaW5nO1xuXG4vKiogVXNlZCB0byBjaGVjayBvYmplY3RzIGZvciBvd24gcHJvcGVydGllcy4gKi9cbnZhciBoYXNPd25Qcm9wZXJ0eSA9IG9iamVjdFByb3RvLmhhc093blByb3BlcnR5O1xuXG4vKiogVXNlZCB0byBkZXRlY3QgbWV0aG9kcyBtYXNxdWVyYWRpbmcgYXMgbmF0aXZlLiAqL1xudmFyIG1hc2tTcmNLZXkgPSAoZnVuY3Rpb24oKSB7XG4gIHZhciB1aWQgPSAvW14uXSskLy5leGVjKGNvcmVKc0RhdGEgJiYgY29yZUpzRGF0YS5rZXlzICYmIGNvcmVKc0RhdGEua2V5cy5JRV9QUk9UTyB8fCAnJyk7XG4gIHJldHVybiB1aWQgPyAoJ1N5bWJvbChzcmMpXzEuJyArIHVpZCkgOiAnJztcbn0oKSk7XG5cbi8qKlxuICogVXNlZCB0byByZXNvbHZlIHRoZVxuICogW2B0b1N0cmluZ1RhZ2BdKGh0dHA6Ly9lY21hLWludGVybmF0aW9uYWwub3JnL2VjbWEtMjYyLzcuMC8jc2VjLW9iamVjdC5wcm90b3R5cGUudG9zdHJpbmcpXG4gKiBvZiB2YWx1ZXMuXG4gKi9cbnZhciBuYXRpdmVPYmplY3RUb1N0cmluZyA9IG9iamVjdFByb3RvLnRvU3RyaW5nO1xuXG4vKiogVXNlZCB0byBkZXRlY3QgaWYgYSBtZXRob2QgaXMgbmF0aXZlLiAqL1xudmFyIHJlSXNOYXRpdmUgPSBSZWdFeHAoJ14nICtcbiAgZnVuY1RvU3RyaW5nLmNhbGwoaGFzT3duUHJvcGVydHkpLnJlcGxhY2UocmVSZWdFeHBDaGFyLCAnXFxcXCQmJylcbiAgLnJlcGxhY2UoL2hhc093blByb3BlcnR5fChmdW5jdGlvbikuKj8oPz1cXFxcXFwoKXwgZm9yIC4rPyg/PVxcXFxcXF0pL2csICckMS4qPycpICsgJyQnXG4pO1xuXG4vKiogQnVpbHQtaW4gdmFsdWUgcmVmZXJlbmNlcy4gKi9cbnZhciBCdWZmZXIgPSBtb2R1bGVFeHBvcnRzID8gcm9vdC5CdWZmZXIgOiB1bmRlZmluZWQsXG4gICAgU3ltYm9sID0gcm9vdC5TeW1ib2wsXG4gICAgVWludDhBcnJheSA9IHJvb3QuVWludDhBcnJheSxcbiAgICBwcm9wZXJ0eUlzRW51bWVyYWJsZSA9IG9iamVjdFByb3RvLnByb3BlcnR5SXNFbnVtZXJhYmxlLFxuICAgIHNwbGljZSA9IGFycmF5UHJvdG8uc3BsaWNlLFxuICAgIHN5bVRvU3RyaW5nVGFnID0gU3ltYm9sID8gU3ltYm9sLnRvU3RyaW5nVGFnIDogdW5kZWZpbmVkO1xuXG4vKiBCdWlsdC1pbiBtZXRob2QgcmVmZXJlbmNlcyBmb3IgdGhvc2Ugd2l0aCB0aGUgc2FtZSBuYW1lIGFzIG90aGVyIGBsb2Rhc2hgIG1ldGhvZHMuICovXG52YXIgbmF0aXZlR2V0U3ltYm9scyA9IE9iamVjdC5nZXRPd25Qcm9wZXJ0eVN5bWJvbHMsXG4gICAgbmF0aXZlSXNCdWZmZXIgPSBCdWZmZXIgPyBCdWZmZXIuaXNCdWZmZXIgOiB1bmRlZmluZWQsXG4gICAgbmF0aXZlS2V5cyA9IG92ZXJBcmcoT2JqZWN0LmtleXMsIE9iamVjdCk7XG5cbi8qIEJ1aWx0LWluIG1ldGhvZCByZWZlcmVuY2VzIHRoYXQgYXJlIHZlcmlmaWVkIHRvIGJlIG5hdGl2ZS4gKi9cbnZhciBEYXRhVmlldyA9IGdldE5hdGl2ZShyb290LCAnRGF0YVZpZXcnKSxcbiAgICBNYXAgPSBnZXROYXRpdmUocm9vdCwgJ01hcCcpLFxuICAgIFByb21pc2UgPSBnZXROYXRpdmUocm9vdCwgJ1Byb21pc2UnKSxcbiAgICBTZXQgPSBnZXROYXRpdmUocm9vdCwgJ1NldCcpLFxuICAgIFdlYWtNYXAgPSBnZXROYXRpdmUocm9vdCwgJ1dlYWtNYXAnKSxcbiAgICBuYXRpdmVDcmVhdGUgPSBnZXROYXRpdmUoT2JqZWN0LCAnY3JlYXRlJyk7XG5cbi8qKiBVc2VkIHRvIGRldGVjdCBtYXBzLCBzZXRzLCBhbmQgd2Vha21hcHMuICovXG52YXIgZGF0YVZpZXdDdG9yU3RyaW5nID0gdG9Tb3VyY2UoRGF0YVZpZXcpLFxuICAgIG1hcEN0b3JTdHJpbmcgPSB0b1NvdXJjZShNYXApLFxuICAgIHByb21pc2VDdG9yU3RyaW5nID0gdG9Tb3VyY2UoUHJvbWlzZSksXG4gICAgc2V0Q3RvclN0cmluZyA9IHRvU291cmNlKFNldCksXG4gICAgd2Vha01hcEN0b3JTdHJpbmcgPSB0b1NvdXJjZShXZWFrTWFwKTtcblxuLyoqIFVzZWQgdG8gY29udmVydCBzeW1ib2xzIHRvIHByaW1pdGl2ZXMgYW5kIHN0cmluZ3MuICovXG52YXIgc3ltYm9sUHJvdG8gPSBTeW1ib2wgPyBTeW1ib2wucHJvdG90eXBlIDogdW5kZWZpbmVkLFxuICAgIHN5bWJvbFZhbHVlT2YgPSBzeW1ib2xQcm90byA/IHN5bWJvbFByb3RvLnZhbHVlT2YgOiB1bmRlZmluZWQ7XG5cbi8qKlxuICogQ3JlYXRlcyBhIGhhc2ggb2JqZWN0LlxuICpcbiAqIEBwcml2YXRlXG4gKiBAY29uc3RydWN0b3JcbiAqIEBwYXJhbSB7QXJyYXl9IFtlbnRyaWVzXSBUaGUga2V5LXZhbHVlIHBhaXJzIHRvIGNhY2hlLlxuICovXG5mdW5jdGlvbiBIYXNoKGVudHJpZXMpIHtcbiAgdmFyIGluZGV4ID0gLTEsXG4gICAgICBsZW5ndGggPSBlbnRyaWVzID09IG51bGwgPyAwIDogZW50cmllcy5sZW5ndGg7XG5cbiAgdGhpcy5jbGVhcigpO1xuICB3aGlsZSAoKytpbmRleCA8IGxlbmd0aCkge1xuICAgIHZhciBlbnRyeSA9IGVudHJpZXNbaW5kZXhdO1xuICAgIHRoaXMuc2V0KGVudHJ5WzBdLCBlbnRyeVsxXSk7XG4gIH1cbn1cblxuLyoqXG4gKiBSZW1vdmVzIGFsbCBrZXktdmFsdWUgZW50cmllcyBmcm9tIHRoZSBoYXNoLlxuICpcbiAqIEBwcml2YXRlXG4gKiBAbmFtZSBjbGVhclxuICogQG1lbWJlck9mIEhhc2hcbiAqL1xuZnVuY3Rpb24gaGFzaENsZWFyKCkge1xuICB0aGlzLl9fZGF0YV9fID0gbmF0aXZlQ3JlYXRlID8gbmF0aXZlQ3JlYXRlKG51bGwpIDoge307XG4gIHRoaXMuc2l6ZSA9IDA7XG59XG5cbi8qKlxuICogUmVtb3ZlcyBga2V5YCBhbmQgaXRzIHZhbHVlIGZyb20gdGhlIGhhc2guXG4gKlxuICogQHByaXZhdGVcbiAqIEBuYW1lIGRlbGV0ZVxuICogQG1lbWJlck9mIEhhc2hcbiAqIEBwYXJhbSB7T2JqZWN0fSBoYXNoIFRoZSBoYXNoIHRvIG1vZGlmeS5cbiAqIEBwYXJhbSB7c3RyaW5nfSBrZXkgVGhlIGtleSBvZiB0aGUgdmFsdWUgdG8gcmVtb3ZlLlxuICogQHJldHVybnMge2Jvb2xlYW59IFJldHVybnMgYHRydWVgIGlmIHRoZSBlbnRyeSB3YXMgcmVtb3ZlZCwgZWxzZSBgZmFsc2VgLlxuICovXG5mdW5jdGlvbiBoYXNoRGVsZXRlKGtleSkge1xuICB2YXIgcmVzdWx0ID0gdGhpcy5oYXMoa2V5KSAmJiBkZWxldGUgdGhpcy5fX2RhdGFfX1trZXldO1xuICB0aGlzLnNpemUgLT0gcmVzdWx0ID8gMSA6IDA7XG4gIHJldHVybiByZXN1bHQ7XG59XG5cbi8qKlxuICogR2V0cyB0aGUgaGFzaCB2YWx1ZSBmb3IgYGtleWAuXG4gKlxuICogQHByaXZhdGVcbiAqIEBuYW1lIGdldFxuICogQG1lbWJlck9mIEhhc2hcbiAqIEBwYXJhbSB7c3RyaW5nfSBrZXkgVGhlIGtleSBvZiB0aGUgdmFsdWUgdG8gZ2V0LlxuICogQHJldHVybnMgeyp9IFJldHVybnMgdGhlIGVudHJ5IHZhbHVlLlxuICovXG5mdW5jdGlvbiBoYXNoR2V0KGtleSkge1xuICB2YXIgZGF0YSA9IHRoaXMuX19kYXRhX187XG4gIGlmIChuYXRpdmVDcmVhdGUpIHtcbiAgICB2YXIgcmVzdWx0ID0gZGF0YVtrZXldO1xuICAgIHJldHVybiByZXN1bHQgPT09IEhBU0hfVU5ERUZJTkVEID8gdW5kZWZpbmVkIDogcmVzdWx0O1xuICB9XG4gIHJldHVybiBoYXNPd25Qcm9wZXJ0eS5jYWxsKGRhdGEsIGtleSkgPyBkYXRhW2tleV0gOiB1bmRlZmluZWQ7XG59XG5cbi8qKlxuICogQ2hlY2tzIGlmIGEgaGFzaCB2YWx1ZSBmb3IgYGtleWAgZXhpc3RzLlxuICpcbiAqIEBwcml2YXRlXG4gKiBAbmFtZSBoYXNcbiAqIEBtZW1iZXJPZiBIYXNoXG4gKiBAcGFyYW0ge3N0cmluZ30ga2V5IFRoZSBrZXkgb2YgdGhlIGVudHJ5IHRvIGNoZWNrLlxuICogQHJldHVybnMge2Jvb2xlYW59IFJldHVybnMgYHRydWVgIGlmIGFuIGVudHJ5IGZvciBga2V5YCBleGlzdHMsIGVsc2UgYGZhbHNlYC5cbiAqL1xuZnVuY3Rpb24gaGFzaEhhcyhrZXkpIHtcbiAgdmFyIGRhdGEgPSB0aGlzLl9fZGF0YV9fO1xuICByZXR1cm4gbmF0aXZlQ3JlYXRlID8gKGRhdGFba2V5XSAhPT0gdW5kZWZpbmVkKSA6IGhhc093blByb3BlcnR5LmNhbGwoZGF0YSwga2V5KTtcbn1cblxuLyoqXG4gKiBTZXRzIHRoZSBoYXNoIGBrZXlgIHRvIGB2YWx1ZWAuXG4gKlxuICogQHByaXZhdGVcbiAqIEBuYW1lIHNldFxuICogQG1lbWJlck9mIEhhc2hcbiAqIEBwYXJhbSB7c3RyaW5nfSBrZXkgVGhlIGtleSBvZiB0aGUgdmFsdWUgdG8gc2V0LlxuICogQHBhcmFtIHsqfSB2YWx1ZSBUaGUgdmFsdWUgdG8gc2V0LlxuICogQHJldHVybnMge09iamVjdH0gUmV0dXJucyB0aGUgaGFzaCBpbnN0YW5jZS5cbiAqL1xuZnVuY3Rpb24gaGFzaFNldChrZXksIHZhbHVlKSB7XG4gIHZhciBkYXRhID0gdGhpcy5fX2RhdGFfXztcbiAgdGhpcy5zaXplICs9IHRoaXMuaGFzKGtleSkgPyAwIDogMTtcbiAgZGF0YVtrZXldID0gKG5hdGl2ZUNyZWF0ZSAmJiB2YWx1ZSA9PT0gdW5kZWZpbmVkKSA/IEhBU0hfVU5ERUZJTkVEIDogdmFsdWU7XG4gIHJldHVybiB0aGlzO1xufVxuXG4vLyBBZGQgbWV0aG9kcyB0byBgSGFzaGAuXG5IYXNoLnByb3RvdHlwZS5jbGVhciA9IGhhc2hDbGVhcjtcbkhhc2gucHJvdG90eXBlWydkZWxldGUnXSA9IGhhc2hEZWxldGU7XG5IYXNoLnByb3RvdHlwZS5nZXQgPSBoYXNoR2V0O1xuSGFzaC5wcm90b3R5cGUuaGFzID0gaGFzaEhhcztcbkhhc2gucHJvdG90eXBlLnNldCA9IGhhc2hTZXQ7XG5cbi8qKlxuICogQ3JlYXRlcyBhbiBsaXN0IGNhY2hlIG9iamVjdC5cbiAqXG4gKiBAcHJpdmF0ZVxuICogQGNvbnN0cnVjdG9yXG4gKiBAcGFyYW0ge0FycmF5fSBbZW50cmllc10gVGhlIGtleS12YWx1ZSBwYWlycyB0byBjYWNoZS5cbiAqL1xuZnVuY3Rpb24gTGlzdENhY2hlKGVudHJpZXMpIHtcbiAgdmFyIGluZGV4ID0gLTEsXG4gICAgICBsZW5ndGggPSBlbnRyaWVzID09IG51bGwgPyAwIDogZW50cmllcy5sZW5ndGg7XG5cbiAgdGhpcy5jbGVhcigpO1xuICB3aGlsZSAoKytpbmRleCA8IGxlbmd0aCkge1xuICAgIHZhciBlbnRyeSA9IGVudHJpZXNbaW5kZXhdO1xuICAgIHRoaXMuc2V0KGVudHJ5WzBdLCBlbnRyeVsxXSk7XG4gIH1cbn1cblxuLyoqXG4gKiBSZW1vdmVzIGFsbCBrZXktdmFsdWUgZW50cmllcyBmcm9tIHRoZSBsaXN0IGNhY2hlLlxuICpcbiAqIEBwcml2YXRlXG4gKiBAbmFtZSBjbGVhclxuICogQG1lbWJlck9mIExpc3RDYWNoZVxuICovXG5mdW5jdGlvbiBsaXN0Q2FjaGVDbGVhcigpIHtcbiAgdGhpcy5fX2RhdGFfXyA9IFtdO1xuICB0aGlzLnNpemUgPSAwO1xufVxuXG4vKipcbiAqIFJlbW92ZXMgYGtleWAgYW5kIGl0cyB2YWx1ZSBmcm9tIHRoZSBsaXN0IGNhY2hlLlxuICpcbiAqIEBwcml2YXRlXG4gKiBAbmFtZSBkZWxldGVcbiAqIEBtZW1iZXJPZiBMaXN0Q2FjaGVcbiAqIEBwYXJhbSB7c3RyaW5nfSBrZXkgVGhlIGtleSBvZiB0aGUgdmFsdWUgdG8gcmVtb3ZlLlxuICogQHJldHVybnMge2Jvb2xlYW59IFJldHVybnMgYHRydWVgIGlmIHRoZSBlbnRyeSB3YXMgcmVtb3ZlZCwgZWxzZSBgZmFsc2VgLlxuICovXG5mdW5jdGlvbiBsaXN0Q2FjaGVEZWxldGUoa2V5KSB7XG4gIHZhciBkYXRhID0gdGhpcy5fX2RhdGFfXyxcbiAgICAgIGluZGV4ID0gYXNzb2NJbmRleE9mKGRhdGEsIGtleSk7XG5cbiAgaWYgKGluZGV4IDwgMCkge1xuICAgIHJldHVybiBmYWxzZTtcbiAgfVxuICB2YXIgbGFzdEluZGV4ID0gZGF0YS5sZW5ndGggLSAxO1xuICBpZiAoaW5kZXggPT0gbGFzdEluZGV4KSB7XG4gICAgZGF0YS5wb3AoKTtcbiAgfSBlbHNlIHtcbiAgICBzcGxpY2UuY2FsbChkYXRhLCBpbmRleCwgMSk7XG4gIH1cbiAgLS10aGlzLnNpemU7XG4gIHJldHVybiB0cnVlO1xufVxuXG4vKipcbiAqIEdldHMgdGhlIGxpc3QgY2FjaGUgdmFsdWUgZm9yIGBrZXlgLlxuICpcbiAqIEBwcml2YXRlXG4gKiBAbmFtZSBnZXRcbiAqIEBtZW1iZXJPZiBMaXN0Q2FjaGVcbiAqIEBwYXJhbSB7c3RyaW5nfSBrZXkgVGhlIGtleSBvZiB0aGUgdmFsdWUgdG8gZ2V0LlxuICogQHJldHVybnMgeyp9IFJldHVybnMgdGhlIGVudHJ5IHZhbHVlLlxuICovXG5mdW5jdGlvbiBsaXN0Q2FjaGVHZXQoa2V5KSB7XG4gIHZhciBkYXRhID0gdGhpcy5fX2RhdGFfXyxcbiAgICAgIGluZGV4ID0gYXNzb2NJbmRleE9mKGRhdGEsIGtleSk7XG5cbiAgcmV0dXJuIGluZGV4IDwgMCA/IHVuZGVmaW5lZCA6IGRhdGFbaW5kZXhdWzFdO1xufVxuXG4vKipcbiAqIENoZWNrcyBpZiBhIGxpc3QgY2FjaGUgdmFsdWUgZm9yIGBrZXlgIGV4aXN0cy5cbiAqXG4gKiBAcHJpdmF0ZVxuICogQG5hbWUgaGFzXG4gKiBAbWVtYmVyT2YgTGlzdENhY2hlXG4gKiBAcGFyYW0ge3N0cmluZ30ga2V5IFRoZSBrZXkgb2YgdGhlIGVudHJ5IHRvIGNoZWNrLlxuICogQHJldHVybnMge2Jvb2xlYW59IFJldHVybnMgYHRydWVgIGlmIGFuIGVudHJ5IGZvciBga2V5YCBleGlzdHMsIGVsc2UgYGZhbHNlYC5cbiAqL1xuZnVuY3Rpb24gbGlzdENhY2hlSGFzKGtleSkge1xuICByZXR1cm4gYXNzb2NJbmRleE9mKHRoaXMuX19kYXRhX18sIGtleSkgPiAtMTtcbn1cblxuLyoqXG4gKiBTZXRzIHRoZSBsaXN0IGNhY2hlIGBrZXlgIHRvIGB2YWx1ZWAuXG4gKlxuICogQHByaXZhdGVcbiAqIEBuYW1lIHNldFxuICogQG1lbWJlck9mIExpc3RDYWNoZVxuICogQHBhcmFtIHtzdHJpbmd9IGtleSBUaGUga2V5IG9mIHRoZSB2YWx1ZSB0byBzZXQuXG4gKiBAcGFyYW0geyp9IHZhbHVlIFRoZSB2YWx1ZSB0byBzZXQuXG4gKiBAcmV0dXJucyB7T2JqZWN0fSBSZXR1cm5zIHRoZSBsaXN0IGNhY2hlIGluc3RhbmNlLlxuICovXG5mdW5jdGlvbiBsaXN0Q2FjaGVTZXQoa2V5LCB2YWx1ZSkge1xuICB2YXIgZGF0YSA9IHRoaXMuX19kYXRhX18sXG4gICAgICBpbmRleCA9IGFzc29jSW5kZXhPZihkYXRhLCBrZXkpO1xuXG4gIGlmIChpbmRleCA8IDApIHtcbiAgICArK3RoaXMuc2l6ZTtcbiAgICBkYXRhLnB1c2goW2tleSwgdmFsdWVdKTtcbiAgfSBlbHNlIHtcbiAgICBkYXRhW2luZGV4XVsxXSA9IHZhbHVlO1xuICB9XG4gIHJldHVybiB0aGlzO1xufVxuXG4vLyBBZGQgbWV0aG9kcyB0byBgTGlzdENhY2hlYC5cbkxpc3RDYWNoZS5wcm90b3R5cGUuY2xlYXIgPSBsaXN0Q2FjaGVDbGVhcjtcbkxpc3RDYWNoZS5wcm90b3R5cGVbJ2RlbGV0ZSddID0gbGlzdENhY2hlRGVsZXRlO1xuTGlzdENhY2hlLnByb3RvdHlwZS5nZXQgPSBsaXN0Q2FjaGVHZXQ7XG5MaXN0Q2FjaGUucHJvdG90eXBlLmhhcyA9IGxpc3RDYWNoZUhhcztcbkxpc3RDYWNoZS5wcm90b3R5cGUuc2V0ID0gbGlzdENhY2hlU2V0O1xuXG4vKipcbiAqIENyZWF0ZXMgYSBtYXAgY2FjaGUgb2JqZWN0IHRvIHN0b3JlIGtleS12YWx1ZSBwYWlycy5cbiAqXG4gKiBAcHJpdmF0ZVxuICogQGNvbnN0cnVjdG9yXG4gKiBAcGFyYW0ge0FycmF5fSBbZW50cmllc10gVGhlIGtleS12YWx1ZSBwYWlycyB0byBjYWNoZS5cbiAqL1xuZnVuY3Rpb24gTWFwQ2FjaGUoZW50cmllcykge1xuICB2YXIgaW5kZXggPSAtMSxcbiAgICAgIGxlbmd0aCA9IGVudHJpZXMgPT0gbnVsbCA/IDAgOiBlbnRyaWVzLmxlbmd0aDtcblxuICB0aGlzLmNsZWFyKCk7XG4gIHdoaWxlICgrK2luZGV4IDwgbGVuZ3RoKSB7XG4gICAgdmFyIGVudHJ5ID0gZW50cmllc1tpbmRleF07XG4gICAgdGhpcy5zZXQoZW50cnlbMF0sIGVudHJ5WzFdKTtcbiAgfVxufVxuXG4vKipcbiAqIFJlbW92ZXMgYWxsIGtleS12YWx1ZSBlbnRyaWVzIGZyb20gdGhlIG1hcC5cbiAqXG4gKiBAcHJpdmF0ZVxuICogQG5hbWUgY2xlYXJcbiAqIEBtZW1iZXJPZiBNYXBDYWNoZVxuICovXG5mdW5jdGlvbiBtYXBDYWNoZUNsZWFyKCkge1xuICB0aGlzLnNpemUgPSAwO1xuICB0aGlzLl9fZGF0YV9fID0ge1xuICAgICdoYXNoJzogbmV3IEhhc2gsXG4gICAgJ21hcCc6IG5ldyAoTWFwIHx8IExpc3RDYWNoZSksXG4gICAgJ3N0cmluZyc6IG5ldyBIYXNoXG4gIH07XG59XG5cbi8qKlxuICogUmVtb3ZlcyBga2V5YCBhbmQgaXRzIHZhbHVlIGZyb20gdGhlIG1hcC5cbiAqXG4gKiBAcHJpdmF0ZVxuICogQG5hbWUgZGVsZXRlXG4gKiBAbWVtYmVyT2YgTWFwQ2FjaGVcbiAqIEBwYXJhbSB7c3RyaW5nfSBrZXkgVGhlIGtleSBvZiB0aGUgdmFsdWUgdG8gcmVtb3ZlLlxuICogQHJldHVybnMge2Jvb2xlYW59IFJldHVybnMgYHRydWVgIGlmIHRoZSBlbnRyeSB3YXMgcmVtb3ZlZCwgZWxzZSBgZmFsc2VgLlxuICovXG5mdW5jdGlvbiBtYXBDYWNoZURlbGV0ZShrZXkpIHtcbiAgdmFyIHJlc3VsdCA9IGdldE1hcERhdGEodGhpcywga2V5KVsnZGVsZXRlJ10oa2V5KTtcbiAgdGhpcy5zaXplIC09IHJlc3VsdCA/IDEgOiAwO1xuICByZXR1cm4gcmVzdWx0O1xufVxuXG4vKipcbiAqIEdldHMgdGhlIG1hcCB2YWx1ZSBmb3IgYGtleWAuXG4gKlxuICogQHByaXZhdGVcbiAqIEBuYW1lIGdldFxuICogQG1lbWJlck9mIE1hcENhY2hlXG4gKiBAcGFyYW0ge3N0cmluZ30ga2V5IFRoZSBrZXkgb2YgdGhlIHZhbHVlIHRvIGdldC5cbiAqIEByZXR1cm5zIHsqfSBSZXR1cm5zIHRoZSBlbnRyeSB2YWx1ZS5cbiAqL1xuZnVuY3Rpb24gbWFwQ2FjaGVHZXQoa2V5KSB7XG4gIHJldHVybiBnZXRNYXBEYXRhKHRoaXMsIGtleSkuZ2V0KGtleSk7XG59XG5cbi8qKlxuICogQ2hlY2tzIGlmIGEgbWFwIHZhbHVlIGZvciBga2V5YCBleGlzdHMuXG4gKlxuICogQHByaXZhdGVcbiAqIEBuYW1lIGhhc1xuICogQG1lbWJlck9mIE1hcENhY2hlXG4gKiBAcGFyYW0ge3N0cmluZ30ga2V5IFRoZSBrZXkgb2YgdGhlIGVudHJ5IHRvIGNoZWNrLlxuICogQHJldHVybnMge2Jvb2xlYW59IFJldHVybnMgYHRydWVgIGlmIGFuIGVudHJ5IGZvciBga2V5YCBleGlzdHMsIGVsc2UgYGZhbHNlYC5cbiAqL1xuZnVuY3Rpb24gbWFwQ2FjaGVIYXMoa2V5KSB7XG4gIHJldHVybiBnZXRNYXBEYXRhKHRoaXMsIGtleSkuaGFzKGtleSk7XG59XG5cbi8qKlxuICogU2V0cyB0aGUgbWFwIGBrZXlgIHRvIGB2YWx1ZWAuXG4gKlxuICogQHByaXZhdGVcbiAqIEBuYW1lIHNldFxuICogQG1lbWJlck9mIE1hcENhY2hlXG4gKiBAcGFyYW0ge3N0cmluZ30ga2V5IFRoZSBrZXkgb2YgdGhlIHZhbHVlIHRvIHNldC5cbiAqIEBwYXJhbSB7Kn0gdmFsdWUgVGhlIHZhbHVlIHRvIHNldC5cbiAqIEByZXR1cm5zIHtPYmplY3R9IFJldHVybnMgdGhlIG1hcCBjYWNoZSBpbnN0YW5jZS5cbiAqL1xuZnVuY3Rpb24gbWFwQ2FjaGVTZXQoa2V5LCB2YWx1ZSkge1xuICB2YXIgZGF0YSA9IGdldE1hcERhdGEodGhpcywga2V5KSxcbiAgICAgIHNpemUgPSBkYXRhLnNpemU7XG5cbiAgZGF0YS5zZXQoa2V5LCB2YWx1ZSk7XG4gIHRoaXMuc2l6ZSArPSBkYXRhLnNpemUgPT0gc2l6ZSA/IDAgOiAxO1xuICByZXR1cm4gdGhpcztcbn1cblxuLy8gQWRkIG1ldGhvZHMgdG8gYE1hcENhY2hlYC5cbk1hcENhY2hlLnByb3RvdHlwZS5jbGVhciA9IG1hcENhY2hlQ2xlYXI7XG5NYXBDYWNoZS5wcm90b3R5cGVbJ2RlbGV0ZSddID0gbWFwQ2FjaGVEZWxldGU7XG5NYXBDYWNoZS5wcm90b3R5cGUuZ2V0ID0gbWFwQ2FjaGVHZXQ7XG5NYXBDYWNoZS5wcm90b3R5cGUuaGFzID0gbWFwQ2FjaGVIYXM7XG5NYXBDYWNoZS5wcm90b3R5cGUuc2V0ID0gbWFwQ2FjaGVTZXQ7XG5cbi8qKlxuICpcbiAqIENyZWF0ZXMgYW4gYXJyYXkgY2FjaGUgb2JqZWN0IHRvIHN0b3JlIHVuaXF1ZSB2YWx1ZXMuXG4gKlxuICogQHByaXZhdGVcbiAqIEBjb25zdHJ1Y3RvclxuICogQHBhcmFtIHtBcnJheX0gW3ZhbHVlc10gVGhlIHZhbHVlcyB0byBjYWNoZS5cbiAqL1xuZnVuY3Rpb24gU2V0Q2FjaGUodmFsdWVzKSB7XG4gIHZhciBpbmRleCA9IC0xLFxuICAgICAgbGVuZ3RoID0gdmFsdWVzID09IG51bGwgPyAwIDogdmFsdWVzLmxlbmd0aDtcblxuICB0aGlzLl9fZGF0YV9fID0gbmV3IE1hcENhY2hlO1xuICB3aGlsZSAoKytpbmRleCA8IGxlbmd0aCkge1xuICAgIHRoaXMuYWRkKHZhbHVlc1tpbmRleF0pO1xuICB9XG59XG5cbi8qKlxuICogQWRkcyBgdmFsdWVgIHRvIHRoZSBhcnJheSBjYWNoZS5cbiAqXG4gKiBAcHJpdmF0ZVxuICogQG5hbWUgYWRkXG4gKiBAbWVtYmVyT2YgU2V0Q2FjaGVcbiAqIEBhbGlhcyBwdXNoXG4gKiBAcGFyYW0geyp9IHZhbHVlIFRoZSB2YWx1ZSB0byBjYWNoZS5cbiAqIEByZXR1cm5zIHtPYmplY3R9IFJldHVybnMgdGhlIGNhY2hlIGluc3RhbmNlLlxuICovXG5mdW5jdGlvbiBzZXRDYWNoZUFkZCh2YWx1ZSkge1xuICB0aGlzLl9fZGF0YV9fLnNldCh2YWx1ZSwgSEFTSF9VTkRFRklORUQpO1xuICByZXR1cm4gdGhpcztcbn1cblxuLyoqXG4gKiBDaGVja3MgaWYgYHZhbHVlYCBpcyBpbiB0aGUgYXJyYXkgY2FjaGUuXG4gKlxuICogQHByaXZhdGVcbiAqIEBuYW1lIGhhc1xuICogQG1lbWJlck9mIFNldENhY2hlXG4gKiBAcGFyYW0geyp9IHZhbHVlIFRoZSB2YWx1ZSB0byBzZWFyY2ggZm9yLlxuICogQHJldHVybnMge251bWJlcn0gUmV0dXJucyBgdHJ1ZWAgaWYgYHZhbHVlYCBpcyBmb3VuZCwgZWxzZSBgZmFsc2VgLlxuICovXG5mdW5jdGlvbiBzZXRDYWNoZUhhcyh2YWx1ZSkge1xuICByZXR1cm4gdGhpcy5fX2RhdGFfXy5oYXModmFsdWUpO1xufVxuXG4vLyBBZGQgbWV0aG9kcyB0byBgU2V0Q2FjaGVgLlxuU2V0Q2FjaGUucHJvdG90eXBlLmFkZCA9IFNldENhY2hlLnByb3RvdHlwZS5wdXNoID0gc2V0Q2FjaGVBZGQ7XG5TZXRDYWNoZS5wcm90b3R5cGUuaGFzID0gc2V0Q2FjaGVIYXM7XG5cbi8qKlxuICogQ3JlYXRlcyBhIHN0YWNrIGNhY2hlIG9iamVjdCB0byBzdG9yZSBrZXktdmFsdWUgcGFpcnMuXG4gKlxuICogQHByaXZhdGVcbiAqIEBjb25zdHJ1Y3RvclxuICogQHBhcmFtIHtBcnJheX0gW2VudHJpZXNdIFRoZSBrZXktdmFsdWUgcGFpcnMgdG8gY2FjaGUuXG4gKi9cbmZ1bmN0aW9uIFN0YWNrKGVudHJpZXMpIHtcbiAgdmFyIGRhdGEgPSB0aGlzLl9fZGF0YV9fID0gbmV3IExpc3RDYWNoZShlbnRyaWVzKTtcbiAgdGhpcy5zaXplID0gZGF0YS5zaXplO1xufVxuXG4vKipcbiAqIFJlbW92ZXMgYWxsIGtleS12YWx1ZSBlbnRyaWVzIGZyb20gdGhlIHN0YWNrLlxuICpcbiAqIEBwcml2YXRlXG4gKiBAbmFtZSBjbGVhclxuICogQG1lbWJlck9mIFN0YWNrXG4gKi9cbmZ1bmN0aW9uIHN0YWNrQ2xlYXIoKSB7XG4gIHRoaXMuX19kYXRhX18gPSBuZXcgTGlzdENhY2hlO1xuICB0aGlzLnNpemUgPSAwO1xufVxuXG4vKipcbiAqIFJlbW92ZXMgYGtleWAgYW5kIGl0cyB2YWx1ZSBmcm9tIHRoZSBzdGFjay5cbiAqXG4gKiBAcHJpdmF0ZVxuICogQG5hbWUgZGVsZXRlXG4gKiBAbWVtYmVyT2YgU3RhY2tcbiAqIEBwYXJhbSB7c3RyaW5nfSBrZXkgVGhlIGtleSBvZiB0aGUgdmFsdWUgdG8gcmVtb3ZlLlxuICogQHJldHVybnMge2Jvb2xlYW59IFJldHVybnMgYHRydWVgIGlmIHRoZSBlbnRyeSB3YXMgcmVtb3ZlZCwgZWxzZSBgZmFsc2VgLlxuICovXG5mdW5jdGlvbiBzdGFja0RlbGV0ZShrZXkpIHtcbiAgdmFyIGRhdGEgPSB0aGlzLl9fZGF0YV9fLFxuICAgICAgcmVzdWx0ID0gZGF0YVsnZGVsZXRlJ10oa2V5KTtcblxuICB0aGlzLnNpemUgPSBkYXRhLnNpemU7XG4gIHJldHVybiByZXN1bHQ7XG59XG5cbi8qKlxuICogR2V0cyB0aGUgc3RhY2sgdmFsdWUgZm9yIGBrZXlgLlxuICpcbiAqIEBwcml2YXRlXG4gKiBAbmFtZSBnZXRcbiAqIEBtZW1iZXJPZiBTdGFja1xuICogQHBhcmFtIHtzdHJpbmd9IGtleSBUaGUga2V5IG9mIHRoZSB2YWx1ZSB0byBnZXQuXG4gKiBAcmV0dXJucyB7Kn0gUmV0dXJucyB0aGUgZW50cnkgdmFsdWUuXG4gKi9cbmZ1bmN0aW9uIHN0YWNrR2V0KGtleSkge1xuICByZXR1cm4gdGhpcy5fX2RhdGFfXy5nZXQoa2V5KTtcbn1cblxuLyoqXG4gKiBDaGVja3MgaWYgYSBzdGFjayB2YWx1ZSBmb3IgYGtleWAgZXhpc3RzLlxuICpcbiAqIEBwcml2YXRlXG4gKiBAbmFtZSBoYXNcbiAqIEBtZW1iZXJPZiBTdGFja1xuICogQHBhcmFtIHtzdHJpbmd9IGtleSBUaGUga2V5IG9mIHRoZSBlbnRyeSB0byBjaGVjay5cbiAqIEByZXR1cm5zIHtib29sZWFufSBSZXR1cm5zIGB0cnVlYCBpZiBhbiBlbnRyeSBmb3IgYGtleWAgZXhpc3RzLCBlbHNlIGBmYWxzZWAuXG4gKi9cbmZ1bmN0aW9uIHN0YWNrSGFzKGtleSkge1xuICByZXR1cm4gdGhpcy5fX2RhdGFfXy5oYXMoa2V5KTtcbn1cblxuLyoqXG4gKiBTZXRzIHRoZSBzdGFjayBga2V5YCB0byBgdmFsdWVgLlxuICpcbiAqIEBwcml2YXRlXG4gKiBAbmFtZSBzZXRcbiAqIEBtZW1iZXJPZiBTdGFja1xuICogQHBhcmFtIHtzdHJpbmd9IGtleSBUaGUga2V5IG9mIHRoZSB2YWx1ZSB0byBzZXQuXG4gKiBAcGFyYW0geyp9IHZhbHVlIFRoZSB2YWx1ZSB0byBzZXQuXG4gKiBAcmV0dXJucyB7T2JqZWN0fSBSZXR1cm5zIHRoZSBzdGFjayBjYWNoZSBpbnN0YW5jZS5cbiAqL1xuZnVuY3Rpb24gc3RhY2tTZXQoa2V5LCB2YWx1ZSkge1xuICB2YXIgZGF0YSA9IHRoaXMuX19kYXRhX187XG4gIGlmIChkYXRhIGluc3RhbmNlb2YgTGlzdENhY2hlKSB7XG4gICAgdmFyIHBhaXJzID0gZGF0YS5fX2RhdGFfXztcbiAgICBpZiAoIU1hcCB8fCAocGFpcnMubGVuZ3RoIDwgTEFSR0VfQVJSQVlfU0laRSAtIDEpKSB7XG4gICAgICBwYWlycy5wdXNoKFtrZXksIHZhbHVlXSk7XG4gICAgICB0aGlzLnNpemUgPSArK2RhdGEuc2l6ZTtcbiAgICAgIHJldHVybiB0aGlzO1xuICAgIH1cbiAgICBkYXRhID0gdGhpcy5fX2RhdGFfXyA9IG5ldyBNYXBDYWNoZShwYWlycyk7XG4gIH1cbiAgZGF0YS5zZXQoa2V5LCB2YWx1ZSk7XG4gIHRoaXMuc2l6ZSA9IGRhdGEuc2l6ZTtcbiAgcmV0dXJuIHRoaXM7XG59XG5cbi8vIEFkZCBtZXRob2RzIHRvIGBTdGFja2AuXG5TdGFjay5wcm90b3R5cGUuY2xlYXIgPSBzdGFja0NsZWFyO1xuU3RhY2sucHJvdG90eXBlWydkZWxldGUnXSA9IHN0YWNrRGVsZXRlO1xuU3RhY2sucHJvdG90eXBlLmdldCA9IHN0YWNrR2V0O1xuU3RhY2sucHJvdG90eXBlLmhhcyA9IHN0YWNrSGFzO1xuU3RhY2sucHJvdG90eXBlLnNldCA9IHN0YWNrU2V0O1xuXG4vKipcbiAqIENyZWF0ZXMgYW4gYXJyYXkgb2YgdGhlIGVudW1lcmFibGUgcHJvcGVydHkgbmFtZXMgb2YgdGhlIGFycmF5LWxpa2UgYHZhbHVlYC5cbiAqXG4gKiBAcHJpdmF0ZVxuICogQHBhcmFtIHsqfSB2YWx1ZSBUaGUgdmFsdWUgdG8gcXVlcnkuXG4gKiBAcGFyYW0ge2Jvb2xlYW59IGluaGVyaXRlZCBTcGVjaWZ5IHJldHVybmluZyBpbmhlcml0ZWQgcHJvcGVydHkgbmFtZXMuXG4gKiBAcmV0dXJucyB7QXJyYXl9IFJldHVybnMgdGhlIGFycmF5IG9mIHByb3BlcnR5IG5hbWVzLlxuICovXG5mdW5jdGlvbiBhcnJheUxpa2VLZXlzKHZhbHVlLCBpbmhlcml0ZWQpIHtcbiAgdmFyIGlzQXJyID0gaXNBcnJheSh2YWx1ZSksXG4gICAgICBpc0FyZyA9ICFpc0FyciAmJiBpc0FyZ3VtZW50cyh2YWx1ZSksXG4gICAgICBpc0J1ZmYgPSAhaXNBcnIgJiYgIWlzQXJnICYmIGlzQnVmZmVyKHZhbHVlKSxcbiAgICAgIGlzVHlwZSA9ICFpc0FyciAmJiAhaXNBcmcgJiYgIWlzQnVmZiAmJiBpc1R5cGVkQXJyYXkodmFsdWUpLFxuICAgICAgc2tpcEluZGV4ZXMgPSBpc0FyciB8fCBpc0FyZyB8fCBpc0J1ZmYgfHwgaXNUeXBlLFxuICAgICAgcmVzdWx0ID0gc2tpcEluZGV4ZXMgPyBiYXNlVGltZXModmFsdWUubGVuZ3RoLCBTdHJpbmcpIDogW10sXG4gICAgICBsZW5ndGggPSByZXN1bHQubGVuZ3RoO1xuXG4gIGZvciAodmFyIGtleSBpbiB2YWx1ZSkge1xuICAgIGlmICgoaW5oZXJpdGVkIHx8IGhhc093blByb3BlcnR5LmNhbGwodmFsdWUsIGtleSkpICYmXG4gICAgICAgICEoc2tpcEluZGV4ZXMgJiYgKFxuICAgICAgICAgICAvLyBTYWZhcmkgOSBoYXMgZW51bWVyYWJsZSBgYXJndW1lbnRzLmxlbmd0aGAgaW4gc3RyaWN0IG1vZGUuXG4gICAgICAgICAgIGtleSA9PSAnbGVuZ3RoJyB8fFxuICAgICAgICAgICAvLyBOb2RlLmpzIDAuMTAgaGFzIGVudW1lcmFibGUgbm9uLWluZGV4IHByb3BlcnRpZXMgb24gYnVmZmVycy5cbiAgICAgICAgICAgKGlzQnVmZiAmJiAoa2V5ID09ICdvZmZzZXQnIHx8IGtleSA9PSAncGFyZW50JykpIHx8XG4gICAgICAgICAgIC8vIFBoYW50b21KUyAyIGhhcyBlbnVtZXJhYmxlIG5vbi1pbmRleCBwcm9wZXJ0aWVzIG9uIHR5cGVkIGFycmF5cy5cbiAgICAgICAgICAgKGlzVHlwZSAmJiAoa2V5ID09ICdidWZmZXInIHx8IGtleSA9PSAnYnl0ZUxlbmd0aCcgfHwga2V5ID09ICdieXRlT2Zmc2V0JykpIHx8XG4gICAgICAgICAgIC8vIFNraXAgaW5kZXggcHJvcGVydGllcy5cbiAgICAgICAgICAgaXNJbmRleChrZXksIGxlbmd0aClcbiAgICAgICAgKSkpIHtcbiAgICAgIHJlc3VsdC5wdXNoKGtleSk7XG4gICAgfVxuICB9XG4gIHJldHVybiByZXN1bHQ7XG59XG5cbi8qKlxuICogR2V0cyB0aGUgaW5kZXggYXQgd2hpY2ggdGhlIGBrZXlgIGlzIGZvdW5kIGluIGBhcnJheWAgb2Yga2V5LXZhbHVlIHBhaXJzLlxuICpcbiAqIEBwcml2YXRlXG4gKiBAcGFyYW0ge0FycmF5fSBhcnJheSBUaGUgYXJyYXkgdG8gaW5zcGVjdC5cbiAqIEBwYXJhbSB7Kn0ga2V5IFRoZSBrZXkgdG8gc2VhcmNoIGZvci5cbiAqIEByZXR1cm5zIHtudW1iZXJ9IFJldHVybnMgdGhlIGluZGV4IG9mIHRoZSBtYXRjaGVkIHZhbHVlLCBlbHNlIGAtMWAuXG4gKi9cbmZ1bmN0aW9uIGFzc29jSW5kZXhPZihhcnJheSwga2V5KSB7XG4gIHZhciBsZW5ndGggPSBhcnJheS5sZW5ndGg7XG4gIHdoaWxlIChsZW5ndGgtLSkge1xuICAgIGlmIChlcShhcnJheVtsZW5ndGhdWzBdLCBrZXkpKSB7XG4gICAgICByZXR1cm4gbGVuZ3RoO1xuICAgIH1cbiAgfVxuICByZXR1cm4gLTE7XG59XG5cbi8qKlxuICogVGhlIGJhc2UgaW1wbGVtZW50YXRpb24gb2YgYGdldEFsbEtleXNgIGFuZCBgZ2V0QWxsS2V5c0luYCB3aGljaCB1c2VzXG4gKiBga2V5c0Z1bmNgIGFuZCBgc3ltYm9sc0Z1bmNgIHRvIGdldCB0aGUgZW51bWVyYWJsZSBwcm9wZXJ0eSBuYW1lcyBhbmRcbiAqIHN5bWJvbHMgb2YgYG9iamVjdGAuXG4gKlxuICogQHByaXZhdGVcbiAqIEBwYXJhbSB7T2JqZWN0fSBvYmplY3QgVGhlIG9iamVjdCB0byBxdWVyeS5cbiAqIEBwYXJhbSB7RnVuY3Rpb259IGtleXNGdW5jIFRoZSBmdW5jdGlvbiB0byBnZXQgdGhlIGtleXMgb2YgYG9iamVjdGAuXG4gKiBAcGFyYW0ge0Z1bmN0aW9ufSBzeW1ib2xzRnVuYyBUaGUgZnVuY3Rpb24gdG8gZ2V0IHRoZSBzeW1ib2xzIG9mIGBvYmplY3RgLlxuICogQHJldHVybnMge0FycmF5fSBSZXR1cm5zIHRoZSBhcnJheSBvZiBwcm9wZXJ0eSBuYW1lcyBhbmQgc3ltYm9scy5cbiAqL1xuZnVuY3Rpb24gYmFzZUdldEFsbEtleXMob2JqZWN0LCBrZXlzRnVuYywgc3ltYm9sc0Z1bmMpIHtcbiAgdmFyIHJlc3VsdCA9IGtleXNGdW5jKG9iamVjdCk7XG4gIHJldHVybiBpc0FycmF5KG9iamVjdCkgPyByZXN1bHQgOiBhcnJheVB1c2gocmVzdWx0LCBzeW1ib2xzRnVuYyhvYmplY3QpKTtcbn1cblxuLyoqXG4gKiBUaGUgYmFzZSBpbXBsZW1lbnRhdGlvbiBvZiBgZ2V0VGFnYCB3aXRob3V0IGZhbGxiYWNrcyBmb3IgYnVnZ3kgZW52aXJvbm1lbnRzLlxuICpcbiAqIEBwcml2YXRlXG4gKiBAcGFyYW0geyp9IHZhbHVlIFRoZSB2YWx1ZSB0byBxdWVyeS5cbiAqIEByZXR1cm5zIHtzdHJpbmd9IFJldHVybnMgdGhlIGB0b1N0cmluZ1RhZ2AuXG4gKi9cbmZ1bmN0aW9uIGJhc2VHZXRUYWcodmFsdWUpIHtcbiAgaWYgKHZhbHVlID09IG51bGwpIHtcbiAgICByZXR1cm4gdmFsdWUgPT09IHVuZGVmaW5lZCA/IHVuZGVmaW5lZFRhZyA6IG51bGxUYWc7XG4gIH1cbiAgcmV0dXJuIChzeW1Ub1N0cmluZ1RhZyAmJiBzeW1Ub1N0cmluZ1RhZyBpbiBPYmplY3QodmFsdWUpKVxuICAgID8gZ2V0UmF3VGFnKHZhbHVlKVxuICAgIDogb2JqZWN0VG9TdHJpbmcodmFsdWUpO1xufVxuXG4vKipcbiAqIFRoZSBiYXNlIGltcGxlbWVudGF0aW9uIG9mIGBfLmlzQXJndW1lbnRzYC5cbiAqXG4gKiBAcHJpdmF0ZVxuICogQHBhcmFtIHsqfSB2YWx1ZSBUaGUgdmFsdWUgdG8gY2hlY2suXG4gKiBAcmV0dXJucyB7Ym9vbGVhbn0gUmV0dXJucyBgdHJ1ZWAgaWYgYHZhbHVlYCBpcyBhbiBgYXJndW1lbnRzYCBvYmplY3QsXG4gKi9cbmZ1bmN0aW9uIGJhc2VJc0FyZ3VtZW50cyh2YWx1ZSkge1xuICByZXR1cm4gaXNPYmplY3RMaWtlKHZhbHVlKSAmJiBiYXNlR2V0VGFnKHZhbHVlKSA9PSBhcmdzVGFnO1xufVxuXG4vKipcbiAqIFRoZSBiYXNlIGltcGxlbWVudGF0aW9uIG9mIGBfLmlzRXF1YWxgIHdoaWNoIHN1cHBvcnRzIHBhcnRpYWwgY29tcGFyaXNvbnNcbiAqIGFuZCB0cmFja3MgdHJhdmVyc2VkIG9iamVjdHMuXG4gKlxuICogQHByaXZhdGVcbiAqIEBwYXJhbSB7Kn0gdmFsdWUgVGhlIHZhbHVlIHRvIGNvbXBhcmUuXG4gKiBAcGFyYW0geyp9IG90aGVyIFRoZSBvdGhlciB2YWx1ZSB0byBjb21wYXJlLlxuICogQHBhcmFtIHtib29sZWFufSBiaXRtYXNrIFRoZSBiaXRtYXNrIGZsYWdzLlxuICogIDEgLSBVbm9yZGVyZWQgY29tcGFyaXNvblxuICogIDIgLSBQYXJ0aWFsIGNvbXBhcmlzb25cbiAqIEBwYXJhbSB7RnVuY3Rpb259IFtjdXN0b21pemVyXSBUaGUgZnVuY3Rpb24gdG8gY3VzdG9taXplIGNvbXBhcmlzb25zLlxuICogQHBhcmFtIHtPYmplY3R9IFtzdGFja10gVHJhY2tzIHRyYXZlcnNlZCBgdmFsdWVgIGFuZCBgb3RoZXJgIG9iamVjdHMuXG4gKiBAcmV0dXJucyB7Ym9vbGVhbn0gUmV0dXJucyBgdHJ1ZWAgaWYgdGhlIHZhbHVlcyBhcmUgZXF1aXZhbGVudCwgZWxzZSBgZmFsc2VgLlxuICovXG5mdW5jdGlvbiBiYXNlSXNFcXVhbCh2YWx1ZSwgb3RoZXIsIGJpdG1hc2ssIGN1c3RvbWl6ZXIsIHN0YWNrKSB7XG4gIGlmICh2YWx1ZSA9PT0gb3RoZXIpIHtcbiAgICByZXR1cm4gdHJ1ZTtcbiAgfVxuICBpZiAodmFsdWUgPT0gbnVsbCB8fCBvdGhlciA9PSBudWxsIHx8ICghaXNPYmplY3RMaWtlKHZhbHVlKSAmJiAhaXNPYmplY3RMaWtlKG90aGVyKSkpIHtcbiAgICByZXR1cm4gdmFsdWUgIT09IHZhbHVlICYmIG90aGVyICE9PSBvdGhlcjtcbiAgfVxuICByZXR1cm4gYmFzZUlzRXF1YWxEZWVwKHZhbHVlLCBvdGhlciwgYml0bWFzaywgY3VzdG9taXplciwgYmFzZUlzRXF1YWwsIHN0YWNrKTtcbn1cblxuLyoqXG4gKiBBIHNwZWNpYWxpemVkIHZlcnNpb24gb2YgYGJhc2VJc0VxdWFsYCBmb3IgYXJyYXlzIGFuZCBvYmplY3RzIHdoaWNoIHBlcmZvcm1zXG4gKiBkZWVwIGNvbXBhcmlzb25zIGFuZCB0cmFja3MgdHJhdmVyc2VkIG9iamVjdHMgZW5hYmxpbmcgb2JqZWN0cyB3aXRoIGNpcmN1bGFyXG4gKiByZWZlcmVuY2VzIHRvIGJlIGNvbXBhcmVkLlxuICpcbiAqIEBwcml2YXRlXG4gKiBAcGFyYW0ge09iamVjdH0gb2JqZWN0IFRoZSBvYmplY3QgdG8gY29tcGFyZS5cbiAqIEBwYXJhbSB7T2JqZWN0fSBvdGhlciBUaGUgb3RoZXIgb2JqZWN0IHRvIGNvbXBhcmUuXG4gKiBAcGFyYW0ge251bWJlcn0gYml0bWFzayBUaGUgYml0bWFzayBmbGFncy4gU2VlIGBiYXNlSXNFcXVhbGAgZm9yIG1vcmUgZGV0YWlscy5cbiAqIEBwYXJhbSB7RnVuY3Rpb259IGN1c3RvbWl6ZXIgVGhlIGZ1bmN0aW9uIHRvIGN1c3RvbWl6ZSBjb21wYXJpc29ucy5cbiAqIEBwYXJhbSB7RnVuY3Rpb259IGVxdWFsRnVuYyBUaGUgZnVuY3Rpb24gdG8gZGV0ZXJtaW5lIGVxdWl2YWxlbnRzIG9mIHZhbHVlcy5cbiAqIEBwYXJhbSB7T2JqZWN0fSBbc3RhY2tdIFRyYWNrcyB0cmF2ZXJzZWQgYG9iamVjdGAgYW5kIGBvdGhlcmAgb2JqZWN0cy5cbiAqIEByZXR1cm5zIHtib29sZWFufSBSZXR1cm5zIGB0cnVlYCBpZiB0aGUgb2JqZWN0cyBhcmUgZXF1aXZhbGVudCwgZWxzZSBgZmFsc2VgLlxuICovXG5mdW5jdGlvbiBiYXNlSXNFcXVhbERlZXAob2JqZWN0LCBvdGhlciwgYml0bWFzaywgY3VzdG9taXplciwgZXF1YWxGdW5jLCBzdGFjaykge1xuICB2YXIgb2JqSXNBcnIgPSBpc0FycmF5KG9iamVjdCksXG4gICAgICBvdGhJc0FyciA9IGlzQXJyYXkob3RoZXIpLFxuICAgICAgb2JqVGFnID0gb2JqSXNBcnIgPyBhcnJheVRhZyA6IGdldFRhZyhvYmplY3QpLFxuICAgICAgb3RoVGFnID0gb3RoSXNBcnIgPyBhcnJheVRhZyA6IGdldFRhZyhvdGhlcik7XG5cbiAgb2JqVGFnID0gb2JqVGFnID09IGFyZ3NUYWcgPyBvYmplY3RUYWcgOiBvYmpUYWc7XG4gIG90aFRhZyA9IG90aFRhZyA9PSBhcmdzVGFnID8gb2JqZWN0VGFnIDogb3RoVGFnO1xuXG4gIHZhciBvYmpJc09iaiA9IG9ialRhZyA9PSBvYmplY3RUYWcsXG4gICAgICBvdGhJc09iaiA9IG90aFRhZyA9PSBvYmplY3RUYWcsXG4gICAgICBpc1NhbWVUYWcgPSBvYmpUYWcgPT0gb3RoVGFnO1xuXG4gIGlmIChpc1NhbWVUYWcgJiYgaXNCdWZmZXIob2JqZWN0KSkge1xuICAgIGlmICghaXNCdWZmZXIob3RoZXIpKSB7XG4gICAgICByZXR1cm4gZmFsc2U7XG4gICAgfVxuICAgIG9iaklzQXJyID0gdHJ1ZTtcbiAgICBvYmpJc09iaiA9IGZhbHNlO1xuICB9XG4gIGlmIChpc1NhbWVUYWcgJiYgIW9iaklzT2JqKSB7XG4gICAgc3RhY2sgfHwgKHN0YWNrID0gbmV3IFN0YWNrKTtcbiAgICByZXR1cm4gKG9iaklzQXJyIHx8IGlzVHlwZWRBcnJheShvYmplY3QpKVxuICAgICAgPyBlcXVhbEFycmF5cyhvYmplY3QsIG90aGVyLCBiaXRtYXNrLCBjdXN0b21pemVyLCBlcXVhbEZ1bmMsIHN0YWNrKVxuICAgICAgOiBlcXVhbEJ5VGFnKG9iamVjdCwgb3RoZXIsIG9ialRhZywgYml0bWFzaywgY3VzdG9taXplciwgZXF1YWxGdW5jLCBzdGFjayk7XG4gIH1cbiAgaWYgKCEoYml0bWFzayAmIENPTVBBUkVfUEFSVElBTF9GTEFHKSkge1xuICAgIHZhciBvYmpJc1dyYXBwZWQgPSBvYmpJc09iaiAmJiBoYXNPd25Qcm9wZXJ0eS5jYWxsKG9iamVjdCwgJ19fd3JhcHBlZF9fJyksXG4gICAgICAgIG90aElzV3JhcHBlZCA9IG90aElzT2JqICYmIGhhc093blByb3BlcnR5LmNhbGwob3RoZXIsICdfX3dyYXBwZWRfXycpO1xuXG4gICAgaWYgKG9iaklzV3JhcHBlZCB8fCBvdGhJc1dyYXBwZWQpIHtcbiAgICAgIHZhciBvYmpVbndyYXBwZWQgPSBvYmpJc1dyYXBwZWQgPyBvYmplY3QudmFsdWUoKSA6IG9iamVjdCxcbiAgICAgICAgICBvdGhVbndyYXBwZWQgPSBvdGhJc1dyYXBwZWQgPyBvdGhlci52YWx1ZSgpIDogb3RoZXI7XG5cbiAgICAgIHN0YWNrIHx8IChzdGFjayA9IG5ldyBTdGFjayk7XG4gICAgICByZXR1cm4gZXF1YWxGdW5jKG9ialVud3JhcHBlZCwgb3RoVW53cmFwcGVkLCBiaXRtYXNrLCBjdXN0b21pemVyLCBzdGFjayk7XG4gICAgfVxuICB9XG4gIGlmICghaXNTYW1lVGFnKSB7XG4gICAgcmV0dXJuIGZhbHNlO1xuICB9XG4gIHN0YWNrIHx8IChzdGFjayA9IG5ldyBTdGFjayk7XG4gIHJldHVybiBlcXVhbE9iamVjdHMob2JqZWN0LCBvdGhlciwgYml0bWFzaywgY3VzdG9taXplciwgZXF1YWxGdW5jLCBzdGFjayk7XG59XG5cbi8qKlxuICogVGhlIGJhc2UgaW1wbGVtZW50YXRpb24gb2YgYF8uaXNOYXRpdmVgIHdpdGhvdXQgYmFkIHNoaW0gY2hlY2tzLlxuICpcbiAqIEBwcml2YXRlXG4gKiBAcGFyYW0geyp9IHZhbHVlIFRoZSB2YWx1ZSB0byBjaGVjay5cbiAqIEByZXR1cm5zIHtib29sZWFufSBSZXR1cm5zIGB0cnVlYCBpZiBgdmFsdWVgIGlzIGEgbmF0aXZlIGZ1bmN0aW9uLFxuICogIGVsc2UgYGZhbHNlYC5cbiAqL1xuZnVuY3Rpb24gYmFzZUlzTmF0aXZlKHZhbHVlKSB7XG4gIGlmICghaXNPYmplY3QodmFsdWUpIHx8IGlzTWFza2VkKHZhbHVlKSkge1xuICAgIHJldHVybiBmYWxzZTtcbiAgfVxuICB2YXIgcGF0dGVybiA9IGlzRnVuY3Rpb24odmFsdWUpID8gcmVJc05hdGl2ZSA6IHJlSXNIb3N0Q3RvcjtcbiAgcmV0dXJuIHBhdHRlcm4udGVzdCh0b1NvdXJjZSh2YWx1ZSkpO1xufVxuXG4vKipcbiAqIFRoZSBiYXNlIGltcGxlbWVudGF0aW9uIG9mIGBfLmlzVHlwZWRBcnJheWAgd2l0aG91dCBOb2RlLmpzIG9wdGltaXphdGlvbnMuXG4gKlxuICogQHByaXZhdGVcbiAqIEBwYXJhbSB7Kn0gdmFsdWUgVGhlIHZhbHVlIHRvIGNoZWNrLlxuICogQHJldHVybnMge2Jvb2xlYW59IFJldHVybnMgYHRydWVgIGlmIGB2YWx1ZWAgaXMgYSB0eXBlZCBhcnJheSwgZWxzZSBgZmFsc2VgLlxuICovXG5mdW5jdGlvbiBiYXNlSXNUeXBlZEFycmF5KHZhbHVlKSB7XG4gIHJldHVybiBpc09iamVjdExpa2UodmFsdWUpICYmXG4gICAgaXNMZW5ndGgodmFsdWUubGVuZ3RoKSAmJiAhIXR5cGVkQXJyYXlUYWdzW2Jhc2VHZXRUYWcodmFsdWUpXTtcbn1cblxuLyoqXG4gKiBUaGUgYmFzZSBpbXBsZW1lbnRhdGlvbiBvZiBgXy5rZXlzYCB3aGljaCBkb2Vzbid0IHRyZWF0IHNwYXJzZSBhcnJheXMgYXMgZGVuc2UuXG4gKlxuICogQHByaXZhdGVcbiAqIEBwYXJhbSB7T2JqZWN0fSBvYmplY3QgVGhlIG9iamVjdCB0byBxdWVyeS5cbiAqIEByZXR1cm5zIHtBcnJheX0gUmV0dXJucyB0aGUgYXJyYXkgb2YgcHJvcGVydHkgbmFtZXMuXG4gKi9cbmZ1bmN0aW9uIGJhc2VLZXlzKG9iamVjdCkge1xuICBpZiAoIWlzUHJvdG90eXBlKG9iamVjdCkpIHtcbiAgICByZXR1cm4gbmF0aXZlS2V5cyhvYmplY3QpO1xuICB9XG4gIHZhciByZXN1bHQgPSBbXTtcbiAgZm9yICh2YXIga2V5IGluIE9iamVjdChvYmplY3QpKSB7XG4gICAgaWYgKGhhc093blByb3BlcnR5LmNhbGwob2JqZWN0LCBrZXkpICYmIGtleSAhPSAnY29uc3RydWN0b3InKSB7XG4gICAgICByZXN1bHQucHVzaChrZXkpO1xuICAgIH1cbiAgfVxuICByZXR1cm4gcmVzdWx0O1xufVxuXG4vKipcbiAqIEEgc3BlY2lhbGl6ZWQgdmVyc2lvbiBvZiBgYmFzZUlzRXF1YWxEZWVwYCBmb3IgYXJyYXlzIHdpdGggc3VwcG9ydCBmb3JcbiAqIHBhcnRpYWwgZGVlcCBjb21wYXJpc29ucy5cbiAqXG4gKiBAcHJpdmF0ZVxuICogQHBhcmFtIHtBcnJheX0gYXJyYXkgVGhlIGFycmF5IHRvIGNvbXBhcmUuXG4gKiBAcGFyYW0ge0FycmF5fSBvdGhlciBUaGUgb3RoZXIgYXJyYXkgdG8gY29tcGFyZS5cbiAqIEBwYXJhbSB7bnVtYmVyfSBiaXRtYXNrIFRoZSBiaXRtYXNrIGZsYWdzLiBTZWUgYGJhc2VJc0VxdWFsYCBmb3IgbW9yZSBkZXRhaWxzLlxuICogQHBhcmFtIHtGdW5jdGlvbn0gY3VzdG9taXplciBUaGUgZnVuY3Rpb24gdG8gY3VzdG9taXplIGNvbXBhcmlzb25zLlxuICogQHBhcmFtIHtGdW5jdGlvbn0gZXF1YWxGdW5jIFRoZSBmdW5jdGlvbiB0byBkZXRlcm1pbmUgZXF1aXZhbGVudHMgb2YgdmFsdWVzLlxuICogQHBhcmFtIHtPYmplY3R9IHN0YWNrIFRyYWNrcyB0cmF2ZXJzZWQgYGFycmF5YCBhbmQgYG90aGVyYCBvYmplY3RzLlxuICogQHJldHVybnMge2Jvb2xlYW59IFJldHVybnMgYHRydWVgIGlmIHRoZSBhcnJheXMgYXJlIGVxdWl2YWxlbnQsIGVsc2UgYGZhbHNlYC5cbiAqL1xuZnVuY3Rpb24gZXF1YWxBcnJheXMoYXJyYXksIG90aGVyLCBiaXRtYXNrLCBjdXN0b21pemVyLCBlcXVhbEZ1bmMsIHN0YWNrKSB7XG4gIHZhciBpc1BhcnRpYWwgPSBiaXRtYXNrICYgQ09NUEFSRV9QQVJUSUFMX0ZMQUcsXG4gICAgICBhcnJMZW5ndGggPSBhcnJheS5sZW5ndGgsXG4gICAgICBvdGhMZW5ndGggPSBvdGhlci5sZW5ndGg7XG5cbiAgaWYgKGFyckxlbmd0aCAhPSBvdGhMZW5ndGggJiYgIShpc1BhcnRpYWwgJiYgb3RoTGVuZ3RoID4gYXJyTGVuZ3RoKSkge1xuICAgIHJldHVybiBmYWxzZTtcbiAgfVxuICAvLyBBc3N1bWUgY3ljbGljIHZhbHVlcyBhcmUgZXF1YWwuXG4gIHZhciBzdGFja2VkID0gc3RhY2suZ2V0KGFycmF5KTtcbiAgaWYgKHN0YWNrZWQgJiYgc3RhY2suZ2V0KG90aGVyKSkge1xuICAgIHJldHVybiBzdGFja2VkID09IG90aGVyO1xuICB9XG4gIHZhciBpbmRleCA9IC0xLFxuICAgICAgcmVzdWx0ID0gdHJ1ZSxcbiAgICAgIHNlZW4gPSAoYml0bWFzayAmIENPTVBBUkVfVU5PUkRFUkVEX0ZMQUcpID8gbmV3IFNldENhY2hlIDogdW5kZWZpbmVkO1xuXG4gIHN0YWNrLnNldChhcnJheSwgb3RoZXIpO1xuICBzdGFjay5zZXQob3RoZXIsIGFycmF5KTtcblxuICAvLyBJZ25vcmUgbm9uLWluZGV4IHByb3BlcnRpZXMuXG4gIHdoaWxlICgrK2luZGV4IDwgYXJyTGVuZ3RoKSB7XG4gICAgdmFyIGFyclZhbHVlID0gYXJyYXlbaW5kZXhdLFxuICAgICAgICBvdGhWYWx1ZSA9IG90aGVyW2luZGV4XTtcblxuICAgIGlmIChjdXN0b21pemVyKSB7XG4gICAgICB2YXIgY29tcGFyZWQgPSBpc1BhcnRpYWxcbiAgICAgICAgPyBjdXN0b21pemVyKG90aFZhbHVlLCBhcnJWYWx1ZSwgaW5kZXgsIG90aGVyLCBhcnJheSwgc3RhY2spXG4gICAgICAgIDogY3VzdG9taXplcihhcnJWYWx1ZSwgb3RoVmFsdWUsIGluZGV4LCBhcnJheSwgb3RoZXIsIHN0YWNrKTtcbiAgICB9XG4gICAgaWYgKGNvbXBhcmVkICE9PSB1bmRlZmluZWQpIHtcbiAgICAgIGlmIChjb21wYXJlZCkge1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cbiAgICAgIHJlc3VsdCA9IGZhbHNlO1xuICAgICAgYnJlYWs7XG4gICAgfVxuICAgIC8vIFJlY3Vyc2l2ZWx5IGNvbXBhcmUgYXJyYXlzIChzdXNjZXB0aWJsZSB0byBjYWxsIHN0YWNrIGxpbWl0cykuXG4gICAgaWYgKHNlZW4pIHtcbiAgICAgIGlmICghYXJyYXlTb21lKG90aGVyLCBmdW5jdGlvbihvdGhWYWx1ZSwgb3RoSW5kZXgpIHtcbiAgICAgICAgICAgIGlmICghY2FjaGVIYXMoc2Vlbiwgb3RoSW5kZXgpICYmXG4gICAgICAgICAgICAgICAgKGFyclZhbHVlID09PSBvdGhWYWx1ZSB8fCBlcXVhbEZ1bmMoYXJyVmFsdWUsIG90aFZhbHVlLCBiaXRtYXNrLCBjdXN0b21pemVyLCBzdGFjaykpKSB7XG4gICAgICAgICAgICAgIHJldHVybiBzZWVuLnB1c2gob3RoSW5kZXgpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgIH0pKSB7XG4gICAgICAgIHJlc3VsdCA9IGZhbHNlO1xuICAgICAgICBicmVhaztcbiAgICAgIH1cbiAgICB9IGVsc2UgaWYgKCEoXG4gICAgICAgICAgYXJyVmFsdWUgPT09IG90aFZhbHVlIHx8XG4gICAgICAgICAgICBlcXVhbEZ1bmMoYXJyVmFsdWUsIG90aFZhbHVlLCBiaXRtYXNrLCBjdXN0b21pemVyLCBzdGFjaylcbiAgICAgICAgKSkge1xuICAgICAgcmVzdWx0ID0gZmFsc2U7XG4gICAgICBicmVhaztcbiAgICB9XG4gIH1cbiAgc3RhY2tbJ2RlbGV0ZSddKGFycmF5KTtcbiAgc3RhY2tbJ2RlbGV0ZSddKG90aGVyKTtcbiAgcmV0dXJuIHJlc3VsdDtcbn1cblxuLyoqXG4gKiBBIHNwZWNpYWxpemVkIHZlcnNpb24gb2YgYGJhc2VJc0VxdWFsRGVlcGAgZm9yIGNvbXBhcmluZyBvYmplY3RzIG9mXG4gKiB0aGUgc2FtZSBgdG9TdHJpbmdUYWdgLlxuICpcbiAqICoqTm90ZToqKiBUaGlzIGZ1bmN0aW9uIG9ubHkgc3VwcG9ydHMgY29tcGFyaW5nIHZhbHVlcyB3aXRoIHRhZ3Mgb2ZcbiAqIGBCb29sZWFuYCwgYERhdGVgLCBgRXJyb3JgLCBgTnVtYmVyYCwgYFJlZ0V4cGAsIG9yIGBTdHJpbmdgLlxuICpcbiAqIEBwcml2YXRlXG4gKiBAcGFyYW0ge09iamVjdH0gb2JqZWN0IFRoZSBvYmplY3QgdG8gY29tcGFyZS5cbiAqIEBwYXJhbSB7T2JqZWN0fSBvdGhlciBUaGUgb3RoZXIgb2JqZWN0IHRvIGNvbXBhcmUuXG4gKiBAcGFyYW0ge3N0cmluZ30gdGFnIFRoZSBgdG9TdHJpbmdUYWdgIG9mIHRoZSBvYmplY3RzIHRvIGNvbXBhcmUuXG4gKiBAcGFyYW0ge251bWJlcn0gYml0bWFzayBUaGUgYml0bWFzayBmbGFncy4gU2VlIGBiYXNlSXNFcXVhbGAgZm9yIG1vcmUgZGV0YWlscy5cbiAqIEBwYXJhbSB7RnVuY3Rpb259IGN1c3RvbWl6ZXIgVGhlIGZ1bmN0aW9uIHRvIGN1c3RvbWl6ZSBjb21wYXJpc29ucy5cbiAqIEBwYXJhbSB7RnVuY3Rpb259IGVxdWFsRnVuYyBUaGUgZnVuY3Rpb24gdG8gZGV0ZXJtaW5lIGVxdWl2YWxlbnRzIG9mIHZhbHVlcy5cbiAqIEBwYXJhbSB7T2JqZWN0fSBzdGFjayBUcmFja3MgdHJhdmVyc2VkIGBvYmplY3RgIGFuZCBgb3RoZXJgIG9iamVjdHMuXG4gKiBAcmV0dXJucyB7Ym9vbGVhbn0gUmV0dXJucyBgdHJ1ZWAgaWYgdGhlIG9iamVjdHMgYXJlIGVxdWl2YWxlbnQsIGVsc2UgYGZhbHNlYC5cbiAqL1xuZnVuY3Rpb24gZXF1YWxCeVRhZyhvYmplY3QsIG90aGVyLCB0YWcsIGJpdG1hc2ssIGN1c3RvbWl6ZXIsIGVxdWFsRnVuYywgc3RhY2spIHtcbiAgc3dpdGNoICh0YWcpIHtcbiAgICBjYXNlIGRhdGFWaWV3VGFnOlxuICAgICAgaWYgKChvYmplY3QuYnl0ZUxlbmd0aCAhPSBvdGhlci5ieXRlTGVuZ3RoKSB8fFxuICAgICAgICAgIChvYmplY3QuYnl0ZU9mZnNldCAhPSBvdGhlci5ieXRlT2Zmc2V0KSkge1xuICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgICB9XG4gICAgICBvYmplY3QgPSBvYmplY3QuYnVmZmVyO1xuICAgICAgb3RoZXIgPSBvdGhlci5idWZmZXI7XG5cbiAgICBjYXNlIGFycmF5QnVmZmVyVGFnOlxuICAgICAgaWYgKChvYmplY3QuYnl0ZUxlbmd0aCAhPSBvdGhlci5ieXRlTGVuZ3RoKSB8fFxuICAgICAgICAgICFlcXVhbEZ1bmMobmV3IFVpbnQ4QXJyYXkob2JqZWN0KSwgbmV3IFVpbnQ4QXJyYXkob3RoZXIpKSkge1xuICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgICB9XG4gICAgICByZXR1cm4gdHJ1ZTtcblxuICAgIGNhc2UgYm9vbFRhZzpcbiAgICBjYXNlIGRhdGVUYWc6XG4gICAgY2FzZSBudW1iZXJUYWc6XG4gICAgICAvLyBDb2VyY2UgYm9vbGVhbnMgdG8gYDFgIG9yIGAwYCBhbmQgZGF0ZXMgdG8gbWlsbGlzZWNvbmRzLlxuICAgICAgLy8gSW52YWxpZCBkYXRlcyBhcmUgY29lcmNlZCB0byBgTmFOYC5cbiAgICAgIHJldHVybiBlcSgrb2JqZWN0LCArb3RoZXIpO1xuXG4gICAgY2FzZSBlcnJvclRhZzpcbiAgICAgIHJldHVybiBvYmplY3QubmFtZSA9PSBvdGhlci5uYW1lICYmIG9iamVjdC5tZXNzYWdlID09IG90aGVyLm1lc3NhZ2U7XG5cbiAgICBjYXNlIHJlZ2V4cFRhZzpcbiAgICBjYXNlIHN0cmluZ1RhZzpcbiAgICAgIC8vIENvZXJjZSByZWdleGVzIHRvIHN0cmluZ3MgYW5kIHRyZWF0IHN0cmluZ3MsIHByaW1pdGl2ZXMgYW5kIG9iamVjdHMsXG4gICAgICAvLyBhcyBlcXVhbC4gU2VlIGh0dHA6Ly93d3cuZWNtYS1pbnRlcm5hdGlvbmFsLm9yZy9lY21hLTI2Mi83LjAvI3NlYy1yZWdleHAucHJvdG90eXBlLnRvc3RyaW5nXG4gICAgICAvLyBmb3IgbW9yZSBkZXRhaWxzLlxuICAgICAgcmV0dXJuIG9iamVjdCA9PSAob3RoZXIgKyAnJyk7XG5cbiAgICBjYXNlIG1hcFRhZzpcbiAgICAgIHZhciBjb252ZXJ0ID0gbWFwVG9BcnJheTtcblxuICAgIGNhc2Ugc2V0VGFnOlxuICAgICAgdmFyIGlzUGFydGlhbCA9IGJpdG1hc2sgJiBDT01QQVJFX1BBUlRJQUxfRkxBRztcbiAgICAgIGNvbnZlcnQgfHwgKGNvbnZlcnQgPSBzZXRUb0FycmF5KTtcblxuICAgICAgaWYgKG9iamVjdC5zaXplICE9IG90aGVyLnNpemUgJiYgIWlzUGFydGlhbCkge1xuICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgICB9XG4gICAgICAvLyBBc3N1bWUgY3ljbGljIHZhbHVlcyBhcmUgZXF1YWwuXG4gICAgICB2YXIgc3RhY2tlZCA9IHN0YWNrLmdldChvYmplY3QpO1xuICAgICAgaWYgKHN0YWNrZWQpIHtcbiAgICAgICAgcmV0dXJuIHN0YWNrZWQgPT0gb3RoZXI7XG4gICAgICB9XG4gICAgICBiaXRtYXNrIHw9IENPTVBBUkVfVU5PUkRFUkVEX0ZMQUc7XG5cbiAgICAgIC8vIFJlY3Vyc2l2ZWx5IGNvbXBhcmUgb2JqZWN0cyAoc3VzY2VwdGlibGUgdG8gY2FsbCBzdGFjayBsaW1pdHMpLlxuICAgICAgc3RhY2suc2V0KG9iamVjdCwgb3RoZXIpO1xuICAgICAgdmFyIHJlc3VsdCA9IGVxdWFsQXJyYXlzKGNvbnZlcnQob2JqZWN0KSwgY29udmVydChvdGhlciksIGJpdG1hc2ssIGN1c3RvbWl6ZXIsIGVxdWFsRnVuYywgc3RhY2spO1xuICAgICAgc3RhY2tbJ2RlbGV0ZSddKG9iamVjdCk7XG4gICAgICByZXR1cm4gcmVzdWx0O1xuXG4gICAgY2FzZSBzeW1ib2xUYWc6XG4gICAgICBpZiAoc3ltYm9sVmFsdWVPZikge1xuICAgICAgICByZXR1cm4gc3ltYm9sVmFsdWVPZi5jYWxsKG9iamVjdCkgPT0gc3ltYm9sVmFsdWVPZi5jYWxsKG90aGVyKTtcbiAgICAgIH1cbiAgfVxuICByZXR1cm4gZmFsc2U7XG59XG5cbi8qKlxuICogQSBzcGVjaWFsaXplZCB2ZXJzaW9uIG9mIGBiYXNlSXNFcXVhbERlZXBgIGZvciBvYmplY3RzIHdpdGggc3VwcG9ydCBmb3JcbiAqIHBhcnRpYWwgZGVlcCBjb21wYXJpc29ucy5cbiAqXG4gKiBAcHJpdmF0ZVxuICogQHBhcmFtIHtPYmplY3R9IG9iamVjdCBUaGUgb2JqZWN0IHRvIGNvbXBhcmUuXG4gKiBAcGFyYW0ge09iamVjdH0gb3RoZXIgVGhlIG90aGVyIG9iamVjdCB0byBjb21wYXJlLlxuICogQHBhcmFtIHtudW1iZXJ9IGJpdG1hc2sgVGhlIGJpdG1hc2sgZmxhZ3MuIFNlZSBgYmFzZUlzRXF1YWxgIGZvciBtb3JlIGRldGFpbHMuXG4gKiBAcGFyYW0ge0Z1bmN0aW9ufSBjdXN0b21pemVyIFRoZSBmdW5jdGlvbiB0byBjdXN0b21pemUgY29tcGFyaXNvbnMuXG4gKiBAcGFyYW0ge0Z1bmN0aW9ufSBlcXVhbEZ1bmMgVGhlIGZ1bmN0aW9uIHRvIGRldGVybWluZSBlcXVpdmFsZW50cyBvZiB2YWx1ZXMuXG4gKiBAcGFyYW0ge09iamVjdH0gc3RhY2sgVHJhY2tzIHRyYXZlcnNlZCBgb2JqZWN0YCBhbmQgYG90aGVyYCBvYmplY3RzLlxuICogQHJldHVybnMge2Jvb2xlYW59IFJldHVybnMgYHRydWVgIGlmIHRoZSBvYmplY3RzIGFyZSBlcXVpdmFsZW50LCBlbHNlIGBmYWxzZWAuXG4gKi9cbmZ1bmN0aW9uIGVxdWFsT2JqZWN0cyhvYmplY3QsIG90aGVyLCBiaXRtYXNrLCBjdXN0b21pemVyLCBlcXVhbEZ1bmMsIHN0YWNrKSB7XG4gIHZhciBpc1BhcnRpYWwgPSBiaXRtYXNrICYgQ09NUEFSRV9QQVJUSUFMX0ZMQUcsXG4gICAgICBvYmpQcm9wcyA9IGdldEFsbEtleXMob2JqZWN0KSxcbiAgICAgIG9iakxlbmd0aCA9IG9ialByb3BzLmxlbmd0aCxcbiAgICAgIG90aFByb3BzID0gZ2V0QWxsS2V5cyhvdGhlciksXG4gICAgICBvdGhMZW5ndGggPSBvdGhQcm9wcy5sZW5ndGg7XG5cbiAgaWYgKG9iakxlbmd0aCAhPSBvdGhMZW5ndGggJiYgIWlzUGFydGlhbCkge1xuICAgIHJldHVybiBmYWxzZTtcbiAgfVxuICB2YXIgaW5kZXggPSBvYmpMZW5ndGg7XG4gIHdoaWxlIChpbmRleC0tKSB7XG4gICAgdmFyIGtleSA9IG9ialByb3BzW2luZGV4XTtcbiAgICBpZiAoIShpc1BhcnRpYWwgPyBrZXkgaW4gb3RoZXIgOiBoYXNPd25Qcm9wZXJ0eS5jYWxsKG90aGVyLCBrZXkpKSkge1xuICAgICAgcmV0dXJuIGZhbHNlO1xuICAgIH1cbiAgfVxuICAvLyBBc3N1bWUgY3ljbGljIHZhbHVlcyBhcmUgZXF1YWwuXG4gIHZhciBzdGFja2VkID0gc3RhY2suZ2V0KG9iamVjdCk7XG4gIGlmIChzdGFja2VkICYmIHN0YWNrLmdldChvdGhlcikpIHtcbiAgICByZXR1cm4gc3RhY2tlZCA9PSBvdGhlcjtcbiAgfVxuICB2YXIgcmVzdWx0ID0gdHJ1ZTtcbiAgc3RhY2suc2V0KG9iamVjdCwgb3RoZXIpO1xuICBzdGFjay5zZXQob3RoZXIsIG9iamVjdCk7XG5cbiAgdmFyIHNraXBDdG9yID0gaXNQYXJ0aWFsO1xuICB3aGlsZSAoKytpbmRleCA8IG9iakxlbmd0aCkge1xuICAgIGtleSA9IG9ialByb3BzW2luZGV4XTtcbiAgICB2YXIgb2JqVmFsdWUgPSBvYmplY3Rba2V5XSxcbiAgICAgICAgb3RoVmFsdWUgPSBvdGhlcltrZXldO1xuXG4gICAgaWYgKGN1c3RvbWl6ZXIpIHtcbiAgICAgIHZhciBjb21wYXJlZCA9IGlzUGFydGlhbFxuICAgICAgICA/IGN1c3RvbWl6ZXIob3RoVmFsdWUsIG9ialZhbHVlLCBrZXksIG90aGVyLCBvYmplY3QsIHN0YWNrKVxuICAgICAgICA6IGN1c3RvbWl6ZXIob2JqVmFsdWUsIG90aFZhbHVlLCBrZXksIG9iamVjdCwgb3RoZXIsIHN0YWNrKTtcbiAgICB9XG4gICAgLy8gUmVjdXJzaXZlbHkgY29tcGFyZSBvYmplY3RzIChzdXNjZXB0aWJsZSB0byBjYWxsIHN0YWNrIGxpbWl0cykuXG4gICAgaWYgKCEoY29tcGFyZWQgPT09IHVuZGVmaW5lZFxuICAgICAgICAgID8gKG9ialZhbHVlID09PSBvdGhWYWx1ZSB8fCBlcXVhbEZ1bmMob2JqVmFsdWUsIG90aFZhbHVlLCBiaXRtYXNrLCBjdXN0b21pemVyLCBzdGFjaykpXG4gICAgICAgICAgOiBjb21wYXJlZFxuICAgICAgICApKSB7XG4gICAgICByZXN1bHQgPSBmYWxzZTtcbiAgICAgIGJyZWFrO1xuICAgIH1cbiAgICBza2lwQ3RvciB8fCAoc2tpcEN0b3IgPSBrZXkgPT0gJ2NvbnN0cnVjdG9yJyk7XG4gIH1cbiAgaWYgKHJlc3VsdCAmJiAhc2tpcEN0b3IpIHtcbiAgICB2YXIgb2JqQ3RvciA9IG9iamVjdC5jb25zdHJ1Y3RvcixcbiAgICAgICAgb3RoQ3RvciA9IG90aGVyLmNvbnN0cnVjdG9yO1xuXG4gICAgLy8gTm9uIGBPYmplY3RgIG9iamVjdCBpbnN0YW5jZXMgd2l0aCBkaWZmZXJlbnQgY29uc3RydWN0b3JzIGFyZSBub3QgZXF1YWwuXG4gICAgaWYgKG9iakN0b3IgIT0gb3RoQ3RvciAmJlxuICAgICAgICAoJ2NvbnN0cnVjdG9yJyBpbiBvYmplY3QgJiYgJ2NvbnN0cnVjdG9yJyBpbiBvdGhlcikgJiZcbiAgICAgICAgISh0eXBlb2Ygb2JqQ3RvciA9PSAnZnVuY3Rpb24nICYmIG9iakN0b3IgaW5zdGFuY2VvZiBvYmpDdG9yICYmXG4gICAgICAgICAgdHlwZW9mIG90aEN0b3IgPT0gJ2Z1bmN0aW9uJyAmJiBvdGhDdG9yIGluc3RhbmNlb2Ygb3RoQ3RvcikpIHtcbiAgICAgIHJlc3VsdCA9IGZhbHNlO1xuICAgIH1cbiAgfVxuICBzdGFja1snZGVsZXRlJ10ob2JqZWN0KTtcbiAgc3RhY2tbJ2RlbGV0ZSddKG90aGVyKTtcbiAgcmV0dXJuIHJlc3VsdDtcbn1cblxuLyoqXG4gKiBDcmVhdGVzIGFuIGFycmF5IG9mIG93biBlbnVtZXJhYmxlIHByb3BlcnR5IG5hbWVzIGFuZCBzeW1ib2xzIG9mIGBvYmplY3RgLlxuICpcbiAqIEBwcml2YXRlXG4gKiBAcGFyYW0ge09iamVjdH0gb2JqZWN0IFRoZSBvYmplY3QgdG8gcXVlcnkuXG4gKiBAcmV0dXJucyB7QXJyYXl9IFJldHVybnMgdGhlIGFycmF5IG9mIHByb3BlcnR5IG5hbWVzIGFuZCBzeW1ib2xzLlxuICovXG5mdW5jdGlvbiBnZXRBbGxLZXlzKG9iamVjdCkge1xuICByZXR1cm4gYmFzZUdldEFsbEtleXMob2JqZWN0LCBrZXlzLCBnZXRTeW1ib2xzKTtcbn1cblxuLyoqXG4gKiBHZXRzIHRoZSBkYXRhIGZvciBgbWFwYC5cbiAqXG4gKiBAcHJpdmF0ZVxuICogQHBhcmFtIHtPYmplY3R9IG1hcCBUaGUgbWFwIHRvIHF1ZXJ5LlxuICogQHBhcmFtIHtzdHJpbmd9IGtleSBUaGUgcmVmZXJlbmNlIGtleS5cbiAqIEByZXR1cm5zIHsqfSBSZXR1cm5zIHRoZSBtYXAgZGF0YS5cbiAqL1xuZnVuY3Rpb24gZ2V0TWFwRGF0YShtYXAsIGtleSkge1xuICB2YXIgZGF0YSA9IG1hcC5fX2RhdGFfXztcbiAgcmV0dXJuIGlzS2V5YWJsZShrZXkpXG4gICAgPyBkYXRhW3R5cGVvZiBrZXkgPT0gJ3N0cmluZycgPyAnc3RyaW5nJyA6ICdoYXNoJ11cbiAgICA6IGRhdGEubWFwO1xufVxuXG4vKipcbiAqIEdldHMgdGhlIG5hdGl2ZSBmdW5jdGlvbiBhdCBga2V5YCBvZiBgb2JqZWN0YC5cbiAqXG4gKiBAcHJpdmF0ZVxuICogQHBhcmFtIHtPYmplY3R9IG9iamVjdCBUaGUgb2JqZWN0IHRvIHF1ZXJ5LlxuICogQHBhcmFtIHtzdHJpbmd9IGtleSBUaGUga2V5IG9mIHRoZSBtZXRob2QgdG8gZ2V0LlxuICogQHJldHVybnMgeyp9IFJldHVybnMgdGhlIGZ1bmN0aW9uIGlmIGl0J3MgbmF0aXZlLCBlbHNlIGB1bmRlZmluZWRgLlxuICovXG5mdW5jdGlvbiBnZXROYXRpdmUob2JqZWN0LCBrZXkpIHtcbiAgdmFyIHZhbHVlID0gZ2V0VmFsdWUob2JqZWN0LCBrZXkpO1xuICByZXR1cm4gYmFzZUlzTmF0aXZlKHZhbHVlKSA/IHZhbHVlIDogdW5kZWZpbmVkO1xufVxuXG4vKipcbiAqIEEgc3BlY2lhbGl6ZWQgdmVyc2lvbiBvZiBgYmFzZUdldFRhZ2Agd2hpY2ggaWdub3JlcyBgU3ltYm9sLnRvU3RyaW5nVGFnYCB2YWx1ZXMuXG4gKlxuICogQHByaXZhdGVcbiAqIEBwYXJhbSB7Kn0gdmFsdWUgVGhlIHZhbHVlIHRvIHF1ZXJ5LlxuICogQHJldHVybnMge3N0cmluZ30gUmV0dXJucyB0aGUgcmF3IGB0b1N0cmluZ1RhZ2AuXG4gKi9cbmZ1bmN0aW9uIGdldFJhd1RhZyh2YWx1ZSkge1xuICB2YXIgaXNPd24gPSBoYXNPd25Qcm9wZXJ0eS5jYWxsKHZhbHVlLCBzeW1Ub1N0cmluZ1RhZyksXG4gICAgICB0YWcgPSB2YWx1ZVtzeW1Ub1N0cmluZ1RhZ107XG5cbiAgdHJ5IHtcbiAgICB2YWx1ZVtzeW1Ub1N0cmluZ1RhZ10gPSB1bmRlZmluZWQ7XG4gICAgdmFyIHVubWFza2VkID0gdHJ1ZTtcbiAgfSBjYXRjaCAoZSkge31cblxuICB2YXIgcmVzdWx0ID0gbmF0aXZlT2JqZWN0VG9TdHJpbmcuY2FsbCh2YWx1ZSk7XG4gIGlmICh1bm1hc2tlZCkge1xuICAgIGlmIChpc093bikge1xuICAgICAgdmFsdWVbc3ltVG9TdHJpbmdUYWddID0gdGFnO1xuICAgIH0gZWxzZSB7XG4gICAgICBkZWxldGUgdmFsdWVbc3ltVG9TdHJpbmdUYWddO1xuICAgIH1cbiAgfVxuICByZXR1cm4gcmVzdWx0O1xufVxuXG4vKipcbiAqIENyZWF0ZXMgYW4gYXJyYXkgb2YgdGhlIG93biBlbnVtZXJhYmxlIHN5bWJvbHMgb2YgYG9iamVjdGAuXG4gKlxuICogQHByaXZhdGVcbiAqIEBwYXJhbSB7T2JqZWN0fSBvYmplY3QgVGhlIG9iamVjdCB0byBxdWVyeS5cbiAqIEByZXR1cm5zIHtBcnJheX0gUmV0dXJucyB0aGUgYXJyYXkgb2Ygc3ltYm9scy5cbiAqL1xudmFyIGdldFN5bWJvbHMgPSAhbmF0aXZlR2V0U3ltYm9scyA/IHN0dWJBcnJheSA6IGZ1bmN0aW9uKG9iamVjdCkge1xuICBpZiAob2JqZWN0ID09IG51bGwpIHtcbiAgICByZXR1cm4gW107XG4gIH1cbiAgb2JqZWN0ID0gT2JqZWN0KG9iamVjdCk7XG4gIHJldHVybiBhcnJheUZpbHRlcihuYXRpdmVHZXRTeW1ib2xzKG9iamVjdCksIGZ1bmN0aW9uKHN5bWJvbCkge1xuICAgIHJldHVybiBwcm9wZXJ0eUlzRW51bWVyYWJsZS5jYWxsKG9iamVjdCwgc3ltYm9sKTtcbiAgfSk7XG59O1xuXG4vKipcbiAqIEdldHMgdGhlIGB0b1N0cmluZ1RhZ2Agb2YgYHZhbHVlYC5cbiAqXG4gKiBAcHJpdmF0ZVxuICogQHBhcmFtIHsqfSB2YWx1ZSBUaGUgdmFsdWUgdG8gcXVlcnkuXG4gKiBAcmV0dXJucyB7c3RyaW5nfSBSZXR1cm5zIHRoZSBgdG9TdHJpbmdUYWdgLlxuICovXG52YXIgZ2V0VGFnID0gYmFzZUdldFRhZztcblxuLy8gRmFsbGJhY2sgZm9yIGRhdGEgdmlld3MsIG1hcHMsIHNldHMsIGFuZCB3ZWFrIG1hcHMgaW4gSUUgMTEgYW5kIHByb21pc2VzIGluIE5vZGUuanMgPCA2LlxuaWYgKChEYXRhVmlldyAmJiBnZXRUYWcobmV3IERhdGFWaWV3KG5ldyBBcnJheUJ1ZmZlcigxKSkpICE9IGRhdGFWaWV3VGFnKSB8fFxuICAgIChNYXAgJiYgZ2V0VGFnKG5ldyBNYXApICE9IG1hcFRhZykgfHxcbiAgICAoUHJvbWlzZSAmJiBnZXRUYWcoUHJvbWlzZS5yZXNvbHZlKCkpICE9IHByb21pc2VUYWcpIHx8XG4gICAgKFNldCAmJiBnZXRUYWcobmV3IFNldCkgIT0gc2V0VGFnKSB8fFxuICAgIChXZWFrTWFwICYmIGdldFRhZyhuZXcgV2Vha01hcCkgIT0gd2Vha01hcFRhZykpIHtcbiAgZ2V0VGFnID0gZnVuY3Rpb24odmFsdWUpIHtcbiAgICB2YXIgcmVzdWx0ID0gYmFzZUdldFRhZyh2YWx1ZSksXG4gICAgICAgIEN0b3IgPSByZXN1bHQgPT0gb2JqZWN0VGFnID8gdmFsdWUuY29uc3RydWN0b3IgOiB1bmRlZmluZWQsXG4gICAgICAgIGN0b3JTdHJpbmcgPSBDdG9yID8gdG9Tb3VyY2UoQ3RvcikgOiAnJztcblxuICAgIGlmIChjdG9yU3RyaW5nKSB7XG4gICAgICBzd2l0Y2ggKGN0b3JTdHJpbmcpIHtcbiAgICAgICAgY2FzZSBkYXRhVmlld0N0b3JTdHJpbmc6IHJldHVybiBkYXRhVmlld1RhZztcbiAgICAgICAgY2FzZSBtYXBDdG9yU3RyaW5nOiByZXR1cm4gbWFwVGFnO1xuICAgICAgICBjYXNlIHByb21pc2VDdG9yU3RyaW5nOiByZXR1cm4gcHJvbWlzZVRhZztcbiAgICAgICAgY2FzZSBzZXRDdG9yU3RyaW5nOiByZXR1cm4gc2V0VGFnO1xuICAgICAgICBjYXNlIHdlYWtNYXBDdG9yU3RyaW5nOiByZXR1cm4gd2Vha01hcFRhZztcbiAgICAgIH1cbiAgICB9XG4gICAgcmV0dXJuIHJlc3VsdDtcbiAgfTtcbn1cblxuLyoqXG4gKiBDaGVja3MgaWYgYHZhbHVlYCBpcyBhIHZhbGlkIGFycmF5LWxpa2UgaW5kZXguXG4gKlxuICogQHByaXZhdGVcbiAqIEBwYXJhbSB7Kn0gdmFsdWUgVGhlIHZhbHVlIHRvIGNoZWNrLlxuICogQHBhcmFtIHtudW1iZXJ9IFtsZW5ndGg9TUFYX1NBRkVfSU5URUdFUl0gVGhlIHVwcGVyIGJvdW5kcyBvZiBhIHZhbGlkIGluZGV4LlxuICogQHJldHVybnMge2Jvb2xlYW59IFJldHVybnMgYHRydWVgIGlmIGB2YWx1ZWAgaXMgYSB2YWxpZCBpbmRleCwgZWxzZSBgZmFsc2VgLlxuICovXG5mdW5jdGlvbiBpc0luZGV4KHZhbHVlLCBsZW5ndGgpIHtcbiAgbGVuZ3RoID0gbGVuZ3RoID09IG51bGwgPyBNQVhfU0FGRV9JTlRFR0VSIDogbGVuZ3RoO1xuICByZXR1cm4gISFsZW5ndGggJiZcbiAgICAodHlwZW9mIHZhbHVlID09ICdudW1iZXInIHx8IHJlSXNVaW50LnRlc3QodmFsdWUpKSAmJlxuICAgICh2YWx1ZSA+IC0xICYmIHZhbHVlICUgMSA9PSAwICYmIHZhbHVlIDwgbGVuZ3RoKTtcbn1cblxuLyoqXG4gKiBDaGVja3MgaWYgYHZhbHVlYCBpcyBzdWl0YWJsZSBmb3IgdXNlIGFzIHVuaXF1ZSBvYmplY3Qga2V5LlxuICpcbiAqIEBwcml2YXRlXG4gKiBAcGFyYW0geyp9IHZhbHVlIFRoZSB2YWx1ZSB0byBjaGVjay5cbiAqIEByZXR1cm5zIHtib29sZWFufSBSZXR1cm5zIGB0cnVlYCBpZiBgdmFsdWVgIGlzIHN1aXRhYmxlLCBlbHNlIGBmYWxzZWAuXG4gKi9cbmZ1bmN0aW9uIGlzS2V5YWJsZSh2YWx1ZSkge1xuICB2YXIgdHlwZSA9IHR5cGVvZiB2YWx1ZTtcbiAgcmV0dXJuICh0eXBlID09ICdzdHJpbmcnIHx8IHR5cGUgPT0gJ251bWJlcicgfHwgdHlwZSA9PSAnc3ltYm9sJyB8fCB0eXBlID09ICdib29sZWFuJylcbiAgICA/ICh2YWx1ZSAhPT0gJ19fcHJvdG9fXycpXG4gICAgOiAodmFsdWUgPT09IG51bGwpO1xufVxuXG4vKipcbiAqIENoZWNrcyBpZiBgZnVuY2AgaGFzIGl0cyBzb3VyY2UgbWFza2VkLlxuICpcbiAqIEBwcml2YXRlXG4gKiBAcGFyYW0ge0Z1bmN0aW9ufSBmdW5jIFRoZSBmdW5jdGlvbiB0byBjaGVjay5cbiAqIEByZXR1cm5zIHtib29sZWFufSBSZXR1cm5zIGB0cnVlYCBpZiBgZnVuY2AgaXMgbWFza2VkLCBlbHNlIGBmYWxzZWAuXG4gKi9cbmZ1bmN0aW9uIGlzTWFza2VkKGZ1bmMpIHtcbiAgcmV0dXJuICEhbWFza1NyY0tleSAmJiAobWFza1NyY0tleSBpbiBmdW5jKTtcbn1cblxuLyoqXG4gKiBDaGVja3MgaWYgYHZhbHVlYCBpcyBsaWtlbHkgYSBwcm90b3R5cGUgb2JqZWN0LlxuICpcbiAqIEBwcml2YXRlXG4gKiBAcGFyYW0geyp9IHZhbHVlIFRoZSB2YWx1ZSB0byBjaGVjay5cbiAqIEByZXR1cm5zIHtib29sZWFufSBSZXR1cm5zIGB0cnVlYCBpZiBgdmFsdWVgIGlzIGEgcHJvdG90eXBlLCBlbHNlIGBmYWxzZWAuXG4gKi9cbmZ1bmN0aW9uIGlzUHJvdG90eXBlKHZhbHVlKSB7XG4gIHZhciBDdG9yID0gdmFsdWUgJiYgdmFsdWUuY29uc3RydWN0b3IsXG4gICAgICBwcm90byA9ICh0eXBlb2YgQ3RvciA9PSAnZnVuY3Rpb24nICYmIEN0b3IucHJvdG90eXBlKSB8fCBvYmplY3RQcm90bztcblxuICByZXR1cm4gdmFsdWUgPT09IHByb3RvO1xufVxuXG4vKipcbiAqIENvbnZlcnRzIGB2YWx1ZWAgdG8gYSBzdHJpbmcgdXNpbmcgYE9iamVjdC5wcm90b3R5cGUudG9TdHJpbmdgLlxuICpcbiAqIEBwcml2YXRlXG4gKiBAcGFyYW0geyp9IHZhbHVlIFRoZSB2YWx1ZSB0byBjb252ZXJ0LlxuICogQHJldHVybnMge3N0cmluZ30gUmV0dXJucyB0aGUgY29udmVydGVkIHN0cmluZy5cbiAqL1xuZnVuY3Rpb24gb2JqZWN0VG9TdHJpbmcodmFsdWUpIHtcbiAgcmV0dXJuIG5hdGl2ZU9iamVjdFRvU3RyaW5nLmNhbGwodmFsdWUpO1xufVxuXG4vKipcbiAqIENvbnZlcnRzIGBmdW5jYCB0byBpdHMgc291cmNlIGNvZGUuXG4gKlxuICogQHByaXZhdGVcbiAqIEBwYXJhbSB7RnVuY3Rpb259IGZ1bmMgVGhlIGZ1bmN0aW9uIHRvIGNvbnZlcnQuXG4gKiBAcmV0dXJucyB7c3RyaW5nfSBSZXR1cm5zIHRoZSBzb3VyY2UgY29kZS5cbiAqL1xuZnVuY3Rpb24gdG9Tb3VyY2UoZnVuYykge1xuICBpZiAoZnVuYyAhPSBudWxsKSB7XG4gICAgdHJ5IHtcbiAgICAgIHJldHVybiBmdW5jVG9TdHJpbmcuY2FsbChmdW5jKTtcbiAgICB9IGNhdGNoIChlKSB7fVxuICAgIHRyeSB7XG4gICAgICByZXR1cm4gKGZ1bmMgKyAnJyk7XG4gICAgfSBjYXRjaCAoZSkge31cbiAgfVxuICByZXR1cm4gJyc7XG59XG5cbi8qKlxuICogUGVyZm9ybXMgYVxuICogW2BTYW1lVmFsdWVaZXJvYF0oaHR0cDovL2VjbWEtaW50ZXJuYXRpb25hbC5vcmcvZWNtYS0yNjIvNy4wLyNzZWMtc2FtZXZhbHVlemVybylcbiAqIGNvbXBhcmlzb24gYmV0d2VlbiB0d28gdmFsdWVzIHRvIGRldGVybWluZSBpZiB0aGV5IGFyZSBlcXVpdmFsZW50LlxuICpcbiAqIEBzdGF0aWNcbiAqIEBtZW1iZXJPZiBfXG4gKiBAc2luY2UgNC4wLjBcbiAqIEBjYXRlZ29yeSBMYW5nXG4gKiBAcGFyYW0geyp9IHZhbHVlIFRoZSB2YWx1ZSB0byBjb21wYXJlLlxuICogQHBhcmFtIHsqfSBvdGhlciBUaGUgb3RoZXIgdmFsdWUgdG8gY29tcGFyZS5cbiAqIEByZXR1cm5zIHtib29sZWFufSBSZXR1cm5zIGB0cnVlYCBpZiB0aGUgdmFsdWVzIGFyZSBlcXVpdmFsZW50LCBlbHNlIGBmYWxzZWAuXG4gKiBAZXhhbXBsZVxuICpcbiAqIHZhciBvYmplY3QgPSB7ICdhJzogMSB9O1xuICogdmFyIG90aGVyID0geyAnYSc6IDEgfTtcbiAqXG4gKiBfLmVxKG9iamVjdCwgb2JqZWN0KTtcbiAqIC8vID0+IHRydWVcbiAqXG4gKiBfLmVxKG9iamVjdCwgb3RoZXIpO1xuICogLy8gPT4gZmFsc2VcbiAqXG4gKiBfLmVxKCdhJywgJ2EnKTtcbiAqIC8vID0+IHRydWVcbiAqXG4gKiBfLmVxKCdhJywgT2JqZWN0KCdhJykpO1xuICogLy8gPT4gZmFsc2VcbiAqXG4gKiBfLmVxKE5hTiwgTmFOKTtcbiAqIC8vID0+IHRydWVcbiAqL1xuZnVuY3Rpb24gZXEodmFsdWUsIG90aGVyKSB7XG4gIHJldHVybiB2YWx1ZSA9PT0gb3RoZXIgfHwgKHZhbHVlICE9PSB2YWx1ZSAmJiBvdGhlciAhPT0gb3RoZXIpO1xufVxuXG4vKipcbiAqIENoZWNrcyBpZiBgdmFsdWVgIGlzIGxpa2VseSBhbiBgYXJndW1lbnRzYCBvYmplY3QuXG4gKlxuICogQHN0YXRpY1xuICogQG1lbWJlck9mIF9cbiAqIEBzaW5jZSAwLjEuMFxuICogQGNhdGVnb3J5IExhbmdcbiAqIEBwYXJhbSB7Kn0gdmFsdWUgVGhlIHZhbHVlIHRvIGNoZWNrLlxuICogQHJldHVybnMge2Jvb2xlYW59IFJldHVybnMgYHRydWVgIGlmIGB2YWx1ZWAgaXMgYW4gYGFyZ3VtZW50c2Agb2JqZWN0LFxuICogIGVsc2UgYGZhbHNlYC5cbiAqIEBleGFtcGxlXG4gKlxuICogXy5pc0FyZ3VtZW50cyhmdW5jdGlvbigpIHsgcmV0dXJuIGFyZ3VtZW50czsgfSgpKTtcbiAqIC8vID0+IHRydWVcbiAqXG4gKiBfLmlzQXJndW1lbnRzKFsxLCAyLCAzXSk7XG4gKiAvLyA9PiBmYWxzZVxuICovXG52YXIgaXNBcmd1bWVudHMgPSBiYXNlSXNBcmd1bWVudHMoZnVuY3Rpb24oKSB7IHJldHVybiBhcmd1bWVudHM7IH0oKSkgPyBiYXNlSXNBcmd1bWVudHMgOiBmdW5jdGlvbih2YWx1ZSkge1xuICByZXR1cm4gaXNPYmplY3RMaWtlKHZhbHVlKSAmJiBoYXNPd25Qcm9wZXJ0eS5jYWxsKHZhbHVlLCAnY2FsbGVlJykgJiZcbiAgICAhcHJvcGVydHlJc0VudW1lcmFibGUuY2FsbCh2YWx1ZSwgJ2NhbGxlZScpO1xufTtcblxuLyoqXG4gKiBDaGVja3MgaWYgYHZhbHVlYCBpcyBjbGFzc2lmaWVkIGFzIGFuIGBBcnJheWAgb2JqZWN0LlxuICpcbiAqIEBzdGF0aWNcbiAqIEBtZW1iZXJPZiBfXG4gKiBAc2luY2UgMC4xLjBcbiAqIEBjYXRlZ29yeSBMYW5nXG4gKiBAcGFyYW0geyp9IHZhbHVlIFRoZSB2YWx1ZSB0byBjaGVjay5cbiAqIEByZXR1cm5zIHtib29sZWFufSBSZXR1cm5zIGB0cnVlYCBpZiBgdmFsdWVgIGlzIGFuIGFycmF5LCBlbHNlIGBmYWxzZWAuXG4gKiBAZXhhbXBsZVxuICpcbiAqIF8uaXNBcnJheShbMSwgMiwgM10pO1xuICogLy8gPT4gdHJ1ZVxuICpcbiAqIF8uaXNBcnJheShkb2N1bWVudC5ib2R5LmNoaWxkcmVuKTtcbiAqIC8vID0+IGZhbHNlXG4gKlxuICogXy5pc0FycmF5KCdhYmMnKTtcbiAqIC8vID0+IGZhbHNlXG4gKlxuICogXy5pc0FycmF5KF8ubm9vcCk7XG4gKiAvLyA9PiBmYWxzZVxuICovXG52YXIgaXNBcnJheSA9IEFycmF5LmlzQXJyYXk7XG5cbi8qKlxuICogQ2hlY2tzIGlmIGB2YWx1ZWAgaXMgYXJyYXktbGlrZS4gQSB2YWx1ZSBpcyBjb25zaWRlcmVkIGFycmF5LWxpa2UgaWYgaXQnc1xuICogbm90IGEgZnVuY3Rpb24gYW5kIGhhcyBhIGB2YWx1ZS5sZW5ndGhgIHRoYXQncyBhbiBpbnRlZ2VyIGdyZWF0ZXIgdGhhbiBvclxuICogZXF1YWwgdG8gYDBgIGFuZCBsZXNzIHRoYW4gb3IgZXF1YWwgdG8gYE51bWJlci5NQVhfU0FGRV9JTlRFR0VSYC5cbiAqXG4gKiBAc3RhdGljXG4gKiBAbWVtYmVyT2YgX1xuICogQHNpbmNlIDQuMC4wXG4gKiBAY2F0ZWdvcnkgTGFuZ1xuICogQHBhcmFtIHsqfSB2YWx1ZSBUaGUgdmFsdWUgdG8gY2hlY2suXG4gKiBAcmV0dXJucyB7Ym9vbGVhbn0gUmV0dXJucyBgdHJ1ZWAgaWYgYHZhbHVlYCBpcyBhcnJheS1saWtlLCBlbHNlIGBmYWxzZWAuXG4gKiBAZXhhbXBsZVxuICpcbiAqIF8uaXNBcnJheUxpa2UoWzEsIDIsIDNdKTtcbiAqIC8vID0+IHRydWVcbiAqXG4gKiBfLmlzQXJyYXlMaWtlKGRvY3VtZW50LmJvZHkuY2hpbGRyZW4pO1xuICogLy8gPT4gdHJ1ZVxuICpcbiAqIF8uaXNBcnJheUxpa2UoJ2FiYycpO1xuICogLy8gPT4gdHJ1ZVxuICpcbiAqIF8uaXNBcnJheUxpa2UoXy5ub29wKTtcbiAqIC8vID0+IGZhbHNlXG4gKi9cbmZ1bmN0aW9uIGlzQXJyYXlMaWtlKHZhbHVlKSB7XG4gIHJldHVybiB2YWx1ZSAhPSBudWxsICYmIGlzTGVuZ3RoKHZhbHVlLmxlbmd0aCkgJiYgIWlzRnVuY3Rpb24odmFsdWUpO1xufVxuXG4vKipcbiAqIENoZWNrcyBpZiBgdmFsdWVgIGlzIGEgYnVmZmVyLlxuICpcbiAqIEBzdGF0aWNcbiAqIEBtZW1iZXJPZiBfXG4gKiBAc2luY2UgNC4zLjBcbiAqIEBjYXRlZ29yeSBMYW5nXG4gKiBAcGFyYW0geyp9IHZhbHVlIFRoZSB2YWx1ZSB0byBjaGVjay5cbiAqIEByZXR1cm5zIHtib29sZWFufSBSZXR1cm5zIGB0cnVlYCBpZiBgdmFsdWVgIGlzIGEgYnVmZmVyLCBlbHNlIGBmYWxzZWAuXG4gKiBAZXhhbXBsZVxuICpcbiAqIF8uaXNCdWZmZXIobmV3IEJ1ZmZlcigyKSk7XG4gKiAvLyA9PiB0cnVlXG4gKlxuICogXy5pc0J1ZmZlcihuZXcgVWludDhBcnJheSgyKSk7XG4gKiAvLyA9PiBmYWxzZVxuICovXG52YXIgaXNCdWZmZXIgPSBuYXRpdmVJc0J1ZmZlciB8fCBzdHViRmFsc2U7XG5cbi8qKlxuICogUGVyZm9ybXMgYSBkZWVwIGNvbXBhcmlzb24gYmV0d2VlbiB0d28gdmFsdWVzIHRvIGRldGVybWluZSBpZiB0aGV5IGFyZVxuICogZXF1aXZhbGVudC5cbiAqXG4gKiAqKk5vdGU6KiogVGhpcyBtZXRob2Qgc3VwcG9ydHMgY29tcGFyaW5nIGFycmF5cywgYXJyYXkgYnVmZmVycywgYm9vbGVhbnMsXG4gKiBkYXRlIG9iamVjdHMsIGVycm9yIG9iamVjdHMsIG1hcHMsIG51bWJlcnMsIGBPYmplY3RgIG9iamVjdHMsIHJlZ2V4ZXMsXG4gKiBzZXRzLCBzdHJpbmdzLCBzeW1ib2xzLCBhbmQgdHlwZWQgYXJyYXlzLiBgT2JqZWN0YCBvYmplY3RzIGFyZSBjb21wYXJlZFxuICogYnkgdGhlaXIgb3duLCBub3QgaW5oZXJpdGVkLCBlbnVtZXJhYmxlIHByb3BlcnRpZXMuIEZ1bmN0aW9ucyBhbmQgRE9NXG4gKiBub2RlcyBhcmUgY29tcGFyZWQgYnkgc3RyaWN0IGVxdWFsaXR5LCBpLmUuIGA9PT1gLlxuICpcbiAqIEBzdGF0aWNcbiAqIEBtZW1iZXJPZiBfXG4gKiBAc2luY2UgMC4xLjBcbiAqIEBjYXRlZ29yeSBMYW5nXG4gKiBAcGFyYW0geyp9IHZhbHVlIFRoZSB2YWx1ZSB0byBjb21wYXJlLlxuICogQHBhcmFtIHsqfSBvdGhlciBUaGUgb3RoZXIgdmFsdWUgdG8gY29tcGFyZS5cbiAqIEByZXR1cm5zIHtib29sZWFufSBSZXR1cm5zIGB0cnVlYCBpZiB0aGUgdmFsdWVzIGFyZSBlcXVpdmFsZW50LCBlbHNlIGBmYWxzZWAuXG4gKiBAZXhhbXBsZVxuICpcbiAqIHZhciBvYmplY3QgPSB7ICdhJzogMSB9O1xuICogdmFyIG90aGVyID0geyAnYSc6IDEgfTtcbiAqXG4gKiBfLmlzRXF1YWwob2JqZWN0LCBvdGhlcik7XG4gKiAvLyA9PiB0cnVlXG4gKlxuICogb2JqZWN0ID09PSBvdGhlcjtcbiAqIC8vID0+IGZhbHNlXG4gKi9cbmZ1bmN0aW9uIGlzRXF1YWwodmFsdWUsIG90aGVyKSB7XG4gIHJldHVybiBiYXNlSXNFcXVhbCh2YWx1ZSwgb3RoZXIpO1xufVxuXG4vKipcbiAqIENoZWNrcyBpZiBgdmFsdWVgIGlzIGNsYXNzaWZpZWQgYXMgYSBgRnVuY3Rpb25gIG9iamVjdC5cbiAqXG4gKiBAc3RhdGljXG4gKiBAbWVtYmVyT2YgX1xuICogQHNpbmNlIDAuMS4wXG4gKiBAY2F0ZWdvcnkgTGFuZ1xuICogQHBhcmFtIHsqfSB2YWx1ZSBUaGUgdmFsdWUgdG8gY2hlY2suXG4gKiBAcmV0dXJucyB7Ym9vbGVhbn0gUmV0dXJucyBgdHJ1ZWAgaWYgYHZhbHVlYCBpcyBhIGZ1bmN0aW9uLCBlbHNlIGBmYWxzZWAuXG4gKiBAZXhhbXBsZVxuICpcbiAqIF8uaXNGdW5jdGlvbihfKTtcbiAqIC8vID0+IHRydWVcbiAqXG4gKiBfLmlzRnVuY3Rpb24oL2FiYy8pO1xuICogLy8gPT4gZmFsc2VcbiAqL1xuZnVuY3Rpb24gaXNGdW5jdGlvbih2YWx1ZSkge1xuICBpZiAoIWlzT2JqZWN0KHZhbHVlKSkge1xuICAgIHJldHVybiBmYWxzZTtcbiAgfVxuICAvLyBUaGUgdXNlIG9mIGBPYmplY3QjdG9TdHJpbmdgIGF2b2lkcyBpc3N1ZXMgd2l0aCB0aGUgYHR5cGVvZmAgb3BlcmF0b3JcbiAgLy8gaW4gU2FmYXJpIDkgd2hpY2ggcmV0dXJucyAnb2JqZWN0JyBmb3IgdHlwZWQgYXJyYXlzIGFuZCBvdGhlciBjb25zdHJ1Y3RvcnMuXG4gIHZhciB0YWcgPSBiYXNlR2V0VGFnKHZhbHVlKTtcbiAgcmV0dXJuIHRhZyA9PSBmdW5jVGFnIHx8IHRhZyA9PSBnZW5UYWcgfHwgdGFnID09IGFzeW5jVGFnIHx8IHRhZyA9PSBwcm94eVRhZztcbn1cblxuLyoqXG4gKiBDaGVja3MgaWYgYHZhbHVlYCBpcyBhIHZhbGlkIGFycmF5LWxpa2UgbGVuZ3RoLlxuICpcbiAqICoqTm90ZToqKiBUaGlzIG1ldGhvZCBpcyBsb29zZWx5IGJhc2VkIG9uXG4gKiBbYFRvTGVuZ3RoYF0oaHR0cDovL2VjbWEtaW50ZXJuYXRpb25hbC5vcmcvZWNtYS0yNjIvNy4wLyNzZWMtdG9sZW5ndGgpLlxuICpcbiAqIEBzdGF0aWNcbiAqIEBtZW1iZXJPZiBfXG4gKiBAc2luY2UgNC4wLjBcbiAqIEBjYXRlZ29yeSBMYW5nXG4gKiBAcGFyYW0geyp9IHZhbHVlIFRoZSB2YWx1ZSB0byBjaGVjay5cbiAqIEByZXR1cm5zIHtib29sZWFufSBSZXR1cm5zIGB0cnVlYCBpZiBgdmFsdWVgIGlzIGEgdmFsaWQgbGVuZ3RoLCBlbHNlIGBmYWxzZWAuXG4gKiBAZXhhbXBsZVxuICpcbiAqIF8uaXNMZW5ndGgoMyk7XG4gKiAvLyA9PiB0cnVlXG4gKlxuICogXy5pc0xlbmd0aChOdW1iZXIuTUlOX1ZBTFVFKTtcbiAqIC8vID0+IGZhbHNlXG4gKlxuICogXy5pc0xlbmd0aChJbmZpbml0eSk7XG4gKiAvLyA9PiBmYWxzZVxuICpcbiAqIF8uaXNMZW5ndGgoJzMnKTtcbiAqIC8vID0+IGZhbHNlXG4gKi9cbmZ1bmN0aW9uIGlzTGVuZ3RoKHZhbHVlKSB7XG4gIHJldHVybiB0eXBlb2YgdmFsdWUgPT0gJ251bWJlcicgJiZcbiAgICB2YWx1ZSA+IC0xICYmIHZhbHVlICUgMSA9PSAwICYmIHZhbHVlIDw9IE1BWF9TQUZFX0lOVEVHRVI7XG59XG5cbi8qKlxuICogQ2hlY2tzIGlmIGB2YWx1ZWAgaXMgdGhlXG4gKiBbbGFuZ3VhZ2UgdHlwZV0oaHR0cDovL3d3dy5lY21hLWludGVybmF0aW9uYWwub3JnL2VjbWEtMjYyLzcuMC8jc2VjLWVjbWFzY3JpcHQtbGFuZ3VhZ2UtdHlwZXMpXG4gKiBvZiBgT2JqZWN0YC4gKGUuZy4gYXJyYXlzLCBmdW5jdGlvbnMsIG9iamVjdHMsIHJlZ2V4ZXMsIGBuZXcgTnVtYmVyKDApYCwgYW5kIGBuZXcgU3RyaW5nKCcnKWApXG4gKlxuICogQHN0YXRpY1xuICogQG1lbWJlck9mIF9cbiAqIEBzaW5jZSAwLjEuMFxuICogQGNhdGVnb3J5IExhbmdcbiAqIEBwYXJhbSB7Kn0gdmFsdWUgVGhlIHZhbHVlIHRvIGNoZWNrLlxuICogQHJldHVybnMge2Jvb2xlYW59IFJldHVybnMgYHRydWVgIGlmIGB2YWx1ZWAgaXMgYW4gb2JqZWN0LCBlbHNlIGBmYWxzZWAuXG4gKiBAZXhhbXBsZVxuICpcbiAqIF8uaXNPYmplY3Qoe30pO1xuICogLy8gPT4gdHJ1ZVxuICpcbiAqIF8uaXNPYmplY3QoWzEsIDIsIDNdKTtcbiAqIC8vID0+IHRydWVcbiAqXG4gKiBfLmlzT2JqZWN0KF8ubm9vcCk7XG4gKiAvLyA9PiB0cnVlXG4gKlxuICogXy5pc09iamVjdChudWxsKTtcbiAqIC8vID0+IGZhbHNlXG4gKi9cbmZ1bmN0aW9uIGlzT2JqZWN0KHZhbHVlKSB7XG4gIHZhciB0eXBlID0gdHlwZW9mIHZhbHVlO1xuICByZXR1cm4gdmFsdWUgIT0gbnVsbCAmJiAodHlwZSA9PSAnb2JqZWN0JyB8fCB0eXBlID09ICdmdW5jdGlvbicpO1xufVxuXG4vKipcbiAqIENoZWNrcyBpZiBgdmFsdWVgIGlzIG9iamVjdC1saWtlLiBBIHZhbHVlIGlzIG9iamVjdC1saWtlIGlmIGl0J3Mgbm90IGBudWxsYFxuICogYW5kIGhhcyBhIGB0eXBlb2ZgIHJlc3VsdCBvZiBcIm9iamVjdFwiLlxuICpcbiAqIEBzdGF0aWNcbiAqIEBtZW1iZXJPZiBfXG4gKiBAc2luY2UgNC4wLjBcbiAqIEBjYXRlZ29yeSBMYW5nXG4gKiBAcGFyYW0geyp9IHZhbHVlIFRoZSB2YWx1ZSB0byBjaGVjay5cbiAqIEByZXR1cm5zIHtib29sZWFufSBSZXR1cm5zIGB0cnVlYCBpZiBgdmFsdWVgIGlzIG9iamVjdC1saWtlLCBlbHNlIGBmYWxzZWAuXG4gKiBAZXhhbXBsZVxuICpcbiAqIF8uaXNPYmplY3RMaWtlKHt9KTtcbiAqIC8vID0+IHRydWVcbiAqXG4gKiBfLmlzT2JqZWN0TGlrZShbMSwgMiwgM10pO1xuICogLy8gPT4gdHJ1ZVxuICpcbiAqIF8uaXNPYmplY3RMaWtlKF8ubm9vcCk7XG4gKiAvLyA9PiBmYWxzZVxuICpcbiAqIF8uaXNPYmplY3RMaWtlKG51bGwpO1xuICogLy8gPT4gZmFsc2VcbiAqL1xuZnVuY3Rpb24gaXNPYmplY3RMaWtlKHZhbHVlKSB7XG4gIHJldHVybiB2YWx1ZSAhPSBudWxsICYmIHR5cGVvZiB2YWx1ZSA9PSAnb2JqZWN0Jztcbn1cblxuLyoqXG4gKiBDaGVja3MgaWYgYHZhbHVlYCBpcyBjbGFzc2lmaWVkIGFzIGEgdHlwZWQgYXJyYXkuXG4gKlxuICogQHN0YXRpY1xuICogQG1lbWJlck9mIF9cbiAqIEBzaW5jZSAzLjAuMFxuICogQGNhdGVnb3J5IExhbmdcbiAqIEBwYXJhbSB7Kn0gdmFsdWUgVGhlIHZhbHVlIHRvIGNoZWNrLlxuICogQHJldHVybnMge2Jvb2xlYW59IFJldHVybnMgYHRydWVgIGlmIGB2YWx1ZWAgaXMgYSB0eXBlZCBhcnJheSwgZWxzZSBgZmFsc2VgLlxuICogQGV4YW1wbGVcbiAqXG4gKiBfLmlzVHlwZWRBcnJheShuZXcgVWludDhBcnJheSk7XG4gKiAvLyA9PiB0cnVlXG4gKlxuICogXy5pc1R5cGVkQXJyYXkoW10pO1xuICogLy8gPT4gZmFsc2VcbiAqL1xudmFyIGlzVHlwZWRBcnJheSA9IG5vZGVJc1R5cGVkQXJyYXkgPyBiYXNlVW5hcnkobm9kZUlzVHlwZWRBcnJheSkgOiBiYXNlSXNUeXBlZEFycmF5O1xuXG4vKipcbiAqIENyZWF0ZXMgYW4gYXJyYXkgb2YgdGhlIG93biBlbnVtZXJhYmxlIHByb3BlcnR5IG5hbWVzIG9mIGBvYmplY3RgLlxuICpcbiAqICoqTm90ZToqKiBOb24tb2JqZWN0IHZhbHVlcyBhcmUgY29lcmNlZCB0byBvYmplY3RzLiBTZWUgdGhlXG4gKiBbRVMgc3BlY10oaHR0cDovL2VjbWEtaW50ZXJuYXRpb25hbC5vcmcvZWNtYS0yNjIvNy4wLyNzZWMtb2JqZWN0LmtleXMpXG4gKiBmb3IgbW9yZSBkZXRhaWxzLlxuICpcbiAqIEBzdGF0aWNcbiAqIEBzaW5jZSAwLjEuMFxuICogQG1lbWJlck9mIF9cbiAqIEBjYXRlZ29yeSBPYmplY3RcbiAqIEBwYXJhbSB7T2JqZWN0fSBvYmplY3QgVGhlIG9iamVjdCB0byBxdWVyeS5cbiAqIEByZXR1cm5zIHtBcnJheX0gUmV0dXJucyB0aGUgYXJyYXkgb2YgcHJvcGVydHkgbmFtZXMuXG4gKiBAZXhhbXBsZVxuICpcbiAqIGZ1bmN0aW9uIEZvbygpIHtcbiAqICAgdGhpcy5hID0gMTtcbiAqICAgdGhpcy5iID0gMjtcbiAqIH1cbiAqXG4gKiBGb28ucHJvdG90eXBlLmMgPSAzO1xuICpcbiAqIF8ua2V5cyhuZXcgRm9vKTtcbiAqIC8vID0+IFsnYScsICdiJ10gKGl0ZXJhdGlvbiBvcmRlciBpcyBub3QgZ3VhcmFudGVlZClcbiAqXG4gKiBfLmtleXMoJ2hpJyk7XG4gKiAvLyA9PiBbJzAnLCAnMSddXG4gKi9cbmZ1bmN0aW9uIGtleXMob2JqZWN0KSB7XG4gIHJldHVybiBpc0FycmF5TGlrZShvYmplY3QpID8gYXJyYXlMaWtlS2V5cyhvYmplY3QpIDogYmFzZUtleXMob2JqZWN0KTtcbn1cblxuLyoqXG4gKiBUaGlzIG1ldGhvZCByZXR1cm5zIGEgbmV3IGVtcHR5IGFycmF5LlxuICpcbiAqIEBzdGF0aWNcbiAqIEBtZW1iZXJPZiBfXG4gKiBAc2luY2UgNC4xMy4wXG4gKiBAY2F0ZWdvcnkgVXRpbFxuICogQHJldHVybnMge0FycmF5fSBSZXR1cm5zIHRoZSBuZXcgZW1wdHkgYXJyYXkuXG4gKiBAZXhhbXBsZVxuICpcbiAqIHZhciBhcnJheXMgPSBfLnRpbWVzKDIsIF8uc3R1YkFycmF5KTtcbiAqXG4gKiBjb25zb2xlLmxvZyhhcnJheXMpO1xuICogLy8gPT4gW1tdLCBbXV1cbiAqXG4gKiBjb25zb2xlLmxvZyhhcnJheXNbMF0gPT09IGFycmF5c1sxXSk7XG4gKiAvLyA9PiBmYWxzZVxuICovXG5mdW5jdGlvbiBzdHViQXJyYXkoKSB7XG4gIHJldHVybiBbXTtcbn1cblxuLyoqXG4gKiBUaGlzIG1ldGhvZCByZXR1cm5zIGBmYWxzZWAuXG4gKlxuICogQHN0YXRpY1xuICogQG1lbWJlck9mIF9cbiAqIEBzaW5jZSA0LjEzLjBcbiAqIEBjYXRlZ29yeSBVdGlsXG4gKiBAcmV0dXJucyB7Ym9vbGVhbn0gUmV0dXJucyBgZmFsc2VgLlxuICogQGV4YW1wbGVcbiAqXG4gKiBfLnRpbWVzKDIsIF8uc3R1YkZhbHNlKTtcbiAqIC8vID0+IFtmYWxzZSwgZmFsc2VdXG4gKi9cbmZ1bmN0aW9uIHN0dWJGYWxzZSgpIHtcbiAgcmV0dXJuIGZhbHNlO1xufVxuXG5tb2R1bGUuZXhwb3J0cyA9IGlzRXF1YWw7XG4iLCJcInVzZSBzdHJpY3RcIjtcbnZhciBfX2ltcG9ydERlZmF1bHQgPSAodGhpcyAmJiB0aGlzLl9faW1wb3J0RGVmYXVsdCkgfHwgZnVuY3Rpb24gKG1vZCkge1xuICAgIHJldHVybiAobW9kICYmIG1vZC5fX2VzTW9kdWxlKSA/IG1vZCA6IHsgXCJkZWZhdWx0XCI6IG1vZCB9O1xufTtcbk9iamVjdC5kZWZpbmVQcm9wZXJ0eShleHBvcnRzLCBcIl9fZXNNb2R1bGVcIiwgeyB2YWx1ZTogdHJ1ZSB9KTtcbnZhciBsb2Rhc2hfY2xvbmVkZWVwXzEgPSBfX2ltcG9ydERlZmF1bHQocmVxdWlyZShcImxvZGFzaC5jbG9uZWRlZXBcIikpO1xudmFyIGxvZGFzaF9pc2VxdWFsXzEgPSBfX2ltcG9ydERlZmF1bHQocmVxdWlyZShcImxvZGFzaC5pc2VxdWFsXCIpKTtcbnZhciBBdHRyaWJ1dGVNYXA7XG4oZnVuY3Rpb24gKEF0dHJpYnV0ZU1hcCkge1xuICAgIGZ1bmN0aW9uIGNvbXBvc2UoYSwgYiwga2VlcE51bGwpIHtcbiAgICAgICAgaWYgKGEgPT09IHZvaWQgMCkgeyBhID0ge307IH1cbiAgICAgICAgaWYgKGIgPT09IHZvaWQgMCkgeyBiID0ge307IH1cbiAgICAgICAgaWYgKHR5cGVvZiBhICE9PSAnb2JqZWN0Jykge1xuICAgICAgICAgICAgYSA9IHt9O1xuICAgICAgICB9XG4gICAgICAgIGlmICh0eXBlb2YgYiAhPT0gJ29iamVjdCcpIHtcbiAgICAgICAgICAgIGIgPSB7fTtcbiAgICAgICAgfVxuICAgICAgICB2YXIgYXR0cmlidXRlcyA9IGxvZGFzaF9jbG9uZWRlZXBfMS5kZWZhdWx0KGIpO1xuICAgICAgICBpZiAoIWtlZXBOdWxsKSB7XG4gICAgICAgICAgICBhdHRyaWJ1dGVzID0gT2JqZWN0LmtleXMoYXR0cmlidXRlcykucmVkdWNlKGZ1bmN0aW9uIChjb3B5LCBrZXkpIHtcbiAgICAgICAgICAgICAgICBpZiAoYXR0cmlidXRlc1trZXldICE9IG51bGwpIHtcbiAgICAgICAgICAgICAgICAgICAgY29weVtrZXldID0gYXR0cmlidXRlc1trZXldO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICByZXR1cm4gY29weTtcbiAgICAgICAgICAgIH0sIHt9KTtcbiAgICAgICAgfVxuICAgICAgICBmb3IgKHZhciBrZXkgaW4gYSkge1xuICAgICAgICAgICAgaWYgKGFba2V5XSAhPT0gdW5kZWZpbmVkICYmIGJba2V5XSA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICAgICAgICAgICAgYXR0cmlidXRlc1trZXldID0gYVtrZXldO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICAgIHJldHVybiBPYmplY3Qua2V5cyhhdHRyaWJ1dGVzKS5sZW5ndGggPiAwID8gYXR0cmlidXRlcyA6IHVuZGVmaW5lZDtcbiAgICB9XG4gICAgQXR0cmlidXRlTWFwLmNvbXBvc2UgPSBjb21wb3NlO1xuICAgIGZ1bmN0aW9uIGRpZmYoYSwgYikge1xuICAgICAgICBpZiAoYSA9PT0gdm9pZCAwKSB7IGEgPSB7fTsgfVxuICAgICAgICBpZiAoYiA9PT0gdm9pZCAwKSB7IGIgPSB7fTsgfVxuICAgICAgICBpZiAodHlwZW9mIGEgIT09ICdvYmplY3QnKSB7XG4gICAgICAgICAgICBhID0ge307XG4gICAgICAgIH1cbiAgICAgICAgaWYgKHR5cGVvZiBiICE9PSAnb2JqZWN0Jykge1xuICAgICAgICAgICAgYiA9IHt9O1xuICAgICAgICB9XG4gICAgICAgIHZhciBhdHRyaWJ1dGVzID0gT2JqZWN0LmtleXMoYSlcbiAgICAgICAgICAgIC5jb25jYXQoT2JqZWN0LmtleXMoYikpXG4gICAgICAgICAgICAucmVkdWNlKGZ1bmN0aW9uIChhdHRycywga2V5KSB7XG4gICAgICAgICAgICBpZiAoIWxvZGFzaF9pc2VxdWFsXzEuZGVmYXVsdChhW2tleV0sIGJba2V5XSkpIHtcbiAgICAgICAgICAgICAgICBhdHRyc1trZXldID0gYltrZXldID09PSB1bmRlZmluZWQgPyBudWxsIDogYltrZXldO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgcmV0dXJuIGF0dHJzO1xuICAgICAgICB9LCB7fSk7XG4gICAgICAgIHJldHVybiBPYmplY3Qua2V5cyhhdHRyaWJ1dGVzKS5sZW5ndGggPiAwID8gYXR0cmlidXRlcyA6IHVuZGVmaW5lZDtcbiAgICB9XG4gICAgQXR0cmlidXRlTWFwLmRpZmYgPSBkaWZmO1xuICAgIGZ1bmN0aW9uIGludmVydChhdHRyLCBiYXNlKSB7XG4gICAgICAgIGlmIChhdHRyID09PSB2b2lkIDApIHsgYXR0ciA9IHt9OyB9XG4gICAgICAgIGlmIChiYXNlID09PSB2b2lkIDApIHsgYmFzZSA9IHt9OyB9XG4gICAgICAgIGF0dHIgPSBhdHRyIHx8IHt9O1xuICAgICAgICB2YXIgYmFzZUludmVydGVkID0gT2JqZWN0LmtleXMoYmFzZSkucmVkdWNlKGZ1bmN0aW9uIChtZW1vLCBrZXkpIHtcbiAgICAgICAgICAgIGlmIChiYXNlW2tleV0gIT09IGF0dHJba2V5XSAmJiBhdHRyW2tleV0gIT09IHVuZGVmaW5lZCkge1xuICAgICAgICAgICAgICAgIG1lbW9ba2V5XSA9IGJhc2Vba2V5XTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHJldHVybiBtZW1vO1xuICAgICAgICB9LCB7fSk7XG4gICAgICAgIHJldHVybiBPYmplY3Qua2V5cyhhdHRyKS5yZWR1Y2UoZnVuY3Rpb24gKG1lbW8sIGtleSkge1xuICAgICAgICAgICAgaWYgKGF0dHJba2V5XSAhPT0gYmFzZVtrZXldICYmIGJhc2Vba2V5XSA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICAgICAgICAgICAgbWVtb1trZXldID0gbnVsbDtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHJldHVybiBtZW1vO1xuICAgICAgICB9LCBiYXNlSW52ZXJ0ZWQpO1xuICAgIH1cbiAgICBBdHRyaWJ1dGVNYXAuaW52ZXJ0ID0gaW52ZXJ0O1xuICAgIGZ1bmN0aW9uIHRyYW5zZm9ybShhLCBiLCBwcmlvcml0eSkge1xuICAgICAgICBpZiAocHJpb3JpdHkgPT09IHZvaWQgMCkgeyBwcmlvcml0eSA9IGZhbHNlOyB9XG4gICAgICAgIGlmICh0eXBlb2YgYSAhPT0gJ29iamVjdCcpIHtcbiAgICAgICAgICAgIHJldHVybiBiO1xuICAgICAgICB9XG4gICAgICAgIGlmICh0eXBlb2YgYiAhPT0gJ29iamVjdCcpIHtcbiAgICAgICAgICAgIHJldHVybiB1bmRlZmluZWQ7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKCFwcmlvcml0eSkge1xuICAgICAgICAgICAgcmV0dXJuIGI7IC8vIGIgc2ltcGx5IG92ZXJ3cml0ZXMgdXMgd2l0aG91dCBwcmlvcml0eVxuICAgICAgICB9XG4gICAgICAgIHZhciBhdHRyaWJ1dGVzID0gT2JqZWN0LmtleXMoYikucmVkdWNlKGZ1bmN0aW9uIChhdHRycywga2V5KSB7XG4gICAgICAgICAgICBpZiAoYVtrZXldID09PSB1bmRlZmluZWQpIHtcbiAgICAgICAgICAgICAgICBhdHRyc1trZXldID0gYltrZXldOyAvLyBudWxsIGlzIGEgdmFsaWQgdmFsdWVcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHJldHVybiBhdHRycztcbiAgICAgICAgfSwge30pO1xuICAgICAgICByZXR1cm4gT2JqZWN0LmtleXMoYXR0cmlidXRlcykubGVuZ3RoID4gMCA/IGF0dHJpYnV0ZXMgOiB1bmRlZmluZWQ7XG4gICAgfVxuICAgIEF0dHJpYnV0ZU1hcC50cmFuc2Zvcm0gPSB0cmFuc2Zvcm07XG59KShBdHRyaWJ1dGVNYXAgfHwgKEF0dHJpYnV0ZU1hcCA9IHt9KSk7XG5leHBvcnRzLmRlZmF1bHQgPSBBdHRyaWJ1dGVNYXA7XG4vLyMgc291cmNlTWFwcGluZ1VSTD1BdHRyaWJ1dGVNYXAuanMubWFwIiwiXCJ1c2Ugc3RyaWN0XCI7XG52YXIgX19pbXBvcnREZWZhdWx0ID0gKHRoaXMgJiYgdGhpcy5fX2ltcG9ydERlZmF1bHQpIHx8IGZ1bmN0aW9uIChtb2QpIHtcbiAgICByZXR1cm4gKG1vZCAmJiBtb2QuX19lc01vZHVsZSkgPyBtb2QgOiB7IFwiZGVmYXVsdFwiOiBtb2QgfTtcbn07XG5PYmplY3QuZGVmaW5lUHJvcGVydHkoZXhwb3J0cywgXCJfX2VzTW9kdWxlXCIsIHsgdmFsdWU6IHRydWUgfSk7XG52YXIgT3BfMSA9IF9faW1wb3J0RGVmYXVsdChyZXF1aXJlKFwiLi9PcFwiKSk7XG52YXIgSXRlcmF0b3IgPSAvKiogQGNsYXNzICovIChmdW5jdGlvbiAoKSB7XG4gICAgZnVuY3Rpb24gSXRlcmF0b3Iob3BzKSB7XG4gICAgICAgIHRoaXMub3BzID0gb3BzO1xuICAgICAgICB0aGlzLmluZGV4ID0gMDtcbiAgICAgICAgdGhpcy5vZmZzZXQgPSAwO1xuICAgIH1cbiAgICBJdGVyYXRvci5wcm90b3R5cGUuaGFzTmV4dCA9IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMucGVla0xlbmd0aCgpIDwgSW5maW5pdHk7XG4gICAgfTtcbiAgICBJdGVyYXRvci5wcm90b3R5cGUubmV4dCA9IGZ1bmN0aW9uIChsZW5ndGgpIHtcbiAgICAgICAgaWYgKCFsZW5ndGgpIHtcbiAgICAgICAgICAgIGxlbmd0aCA9IEluZmluaXR5O1xuICAgICAgICB9XG4gICAgICAgIHZhciBuZXh0T3AgPSB0aGlzLm9wc1t0aGlzLmluZGV4XTtcbiAgICAgICAgaWYgKG5leHRPcCkge1xuICAgICAgICAgICAgdmFyIG9mZnNldCA9IHRoaXMub2Zmc2V0O1xuICAgICAgICAgICAgdmFyIG9wTGVuZ3RoID0gT3BfMS5kZWZhdWx0Lmxlbmd0aChuZXh0T3ApO1xuICAgICAgICAgICAgaWYgKGxlbmd0aCA+PSBvcExlbmd0aCAtIG9mZnNldCkge1xuICAgICAgICAgICAgICAgIGxlbmd0aCA9IG9wTGVuZ3RoIC0gb2Zmc2V0O1xuICAgICAgICAgICAgICAgIHRoaXMuaW5kZXggKz0gMTtcbiAgICAgICAgICAgICAgICB0aGlzLm9mZnNldCA9IDA7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBlbHNlIHtcbiAgICAgICAgICAgICAgICB0aGlzLm9mZnNldCArPSBsZW5ndGg7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBpZiAodHlwZW9mIG5leHRPcC5kZWxldGUgPT09ICdudW1iZXInKSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIHsgZGVsZXRlOiBsZW5ndGggfTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGVsc2Uge1xuICAgICAgICAgICAgICAgIHZhciByZXRPcCA9IHt9O1xuICAgICAgICAgICAgICAgIGlmIChuZXh0T3AuYXR0cmlidXRlcykge1xuICAgICAgICAgICAgICAgICAgICByZXRPcC5hdHRyaWJ1dGVzID0gbmV4dE9wLmF0dHJpYnV0ZXM7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIGlmICh0eXBlb2YgbmV4dE9wLnJldGFpbiA9PT0gJ251bWJlcicpIHtcbiAgICAgICAgICAgICAgICAgICAgcmV0T3AucmV0YWluID0gbGVuZ3RoO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBlbHNlIGlmICh0eXBlb2YgbmV4dE9wLmluc2VydCA9PT0gJ3N0cmluZycpIHtcbiAgICAgICAgICAgICAgICAgICAgcmV0T3AuaW5zZXJ0ID0gbmV4dE9wLmluc2VydC5zdWJzdHIob2Zmc2V0LCBsZW5ndGgpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBlbHNlIHtcbiAgICAgICAgICAgICAgICAgICAgLy8gb2Zmc2V0IHNob3VsZCA9PT0gMCwgbGVuZ3RoIHNob3VsZCA9PT0gMVxuICAgICAgICAgICAgICAgICAgICByZXRPcC5pbnNlcnQgPSBuZXh0T3AuaW5zZXJ0O1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICByZXR1cm4gcmV0T3A7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgICAgZWxzZSB7XG4gICAgICAgICAgICByZXR1cm4geyByZXRhaW46IEluZmluaXR5IH07XG4gICAgICAgIH1cbiAgICB9O1xuICAgIEl0ZXJhdG9yLnByb3RvdHlwZS5wZWVrID0gZnVuY3Rpb24gKCkge1xuICAgICAgICByZXR1cm4gdGhpcy5vcHNbdGhpcy5pbmRleF07XG4gICAgfTtcbiAgICBJdGVyYXRvci5wcm90b3R5cGUucGVla0xlbmd0aCA9IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgaWYgKHRoaXMub3BzW3RoaXMuaW5kZXhdKSB7XG4gICAgICAgICAgICAvLyBTaG91bGQgbmV2ZXIgcmV0dXJuIDAgaWYgb3VyIGluZGV4IGlzIGJlaW5nIG1hbmFnZWQgY29ycmVjdGx5XG4gICAgICAgICAgICByZXR1cm4gT3BfMS5kZWZhdWx0Lmxlbmd0aCh0aGlzLm9wc1t0aGlzLmluZGV4XSkgLSB0aGlzLm9mZnNldDtcbiAgICAgICAgfVxuICAgICAgICBlbHNlIHtcbiAgICAgICAgICAgIHJldHVybiBJbmZpbml0eTtcbiAgICAgICAgfVxuICAgIH07XG4gICAgSXRlcmF0b3IucHJvdG90eXBlLnBlZWtUeXBlID0gZnVuY3Rpb24gKCkge1xuICAgICAgICBpZiAodGhpcy5vcHNbdGhpcy5pbmRleF0pIHtcbiAgICAgICAgICAgIGlmICh0eXBlb2YgdGhpcy5vcHNbdGhpcy5pbmRleF0uZGVsZXRlID09PSAnbnVtYmVyJykge1xuICAgICAgICAgICAgICAgIHJldHVybiAnZGVsZXRlJztcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGVsc2UgaWYgKHR5cGVvZiB0aGlzLm9wc1t0aGlzLmluZGV4XS5yZXRhaW4gPT09ICdudW1iZXInKSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuICdyZXRhaW4nO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgZWxzZSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuICdpbnNlcnQnO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICAgIHJldHVybiAncmV0YWluJztcbiAgICB9O1xuICAgIEl0ZXJhdG9yLnByb3RvdHlwZS5yZXN0ID0gZnVuY3Rpb24gKCkge1xuICAgICAgICBpZiAoIXRoaXMuaGFzTmV4dCgpKSB7XG4gICAgICAgICAgICByZXR1cm4gW107XG4gICAgICAgIH1cbiAgICAgICAgZWxzZSBpZiAodGhpcy5vZmZzZXQgPT09IDApIHtcbiAgICAgICAgICAgIHJldHVybiB0aGlzLm9wcy5zbGljZSh0aGlzLmluZGV4KTtcbiAgICAgICAgfVxuICAgICAgICBlbHNlIHtcbiAgICAgICAgICAgIHZhciBvZmZzZXQgPSB0aGlzLm9mZnNldDtcbiAgICAgICAgICAgIHZhciBpbmRleCA9IHRoaXMuaW5kZXg7XG4gICAgICAgICAgICB2YXIgbmV4dCA9IHRoaXMubmV4dCgpO1xuICAgICAgICAgICAgdmFyIHJlc3QgPSB0aGlzLm9wcy5zbGljZSh0aGlzLmluZGV4KTtcbiAgICAgICAgICAgIHRoaXMub2Zmc2V0ID0gb2Zmc2V0O1xuICAgICAgICAgICAgdGhpcy5pbmRleCA9IGluZGV4O1xuICAgICAgICAgICAgcmV0dXJuIFtuZXh0XS5jb25jYXQocmVzdCk7XG4gICAgICAgIH1cbiAgICB9O1xuICAgIHJldHVybiBJdGVyYXRvcjtcbn0oKSk7XG5leHBvcnRzLmRlZmF1bHQgPSBJdGVyYXRvcjtcbi8vIyBzb3VyY2VNYXBwaW5nVVJMPUl0ZXJhdG9yLmpzLm1hcCIsIlwidXNlIHN0cmljdFwiO1xudmFyIF9faW1wb3J0RGVmYXVsdCA9ICh0aGlzICYmIHRoaXMuX19pbXBvcnREZWZhdWx0KSB8fCBmdW5jdGlvbiAobW9kKSB7XG4gICAgcmV0dXJuIChtb2QgJiYgbW9kLl9fZXNNb2R1bGUpID8gbW9kIDogeyBcImRlZmF1bHRcIjogbW9kIH07XG59O1xuT2JqZWN0LmRlZmluZVByb3BlcnR5KGV4cG9ydHMsIFwiX19lc01vZHVsZVwiLCB7IHZhbHVlOiB0cnVlIH0pO1xudmFyIEl0ZXJhdG9yXzEgPSBfX2ltcG9ydERlZmF1bHQocmVxdWlyZShcIi4vSXRlcmF0b3JcIikpO1xudmFyIE9wO1xuKGZ1bmN0aW9uIChPcCkge1xuICAgIGZ1bmN0aW9uIGl0ZXJhdG9yKG9wcykge1xuICAgICAgICByZXR1cm4gbmV3IEl0ZXJhdG9yXzEuZGVmYXVsdChvcHMpO1xuICAgIH1cbiAgICBPcC5pdGVyYXRvciA9IGl0ZXJhdG9yO1xuICAgIGZ1bmN0aW9uIGxlbmd0aChvcCkge1xuICAgICAgICBpZiAodHlwZW9mIG9wLmRlbGV0ZSA9PT0gJ251bWJlcicpIHtcbiAgICAgICAgICAgIHJldHVybiBvcC5kZWxldGU7XG4gICAgICAgIH1cbiAgICAgICAgZWxzZSBpZiAodHlwZW9mIG9wLnJldGFpbiA9PT0gJ251bWJlcicpIHtcbiAgICAgICAgICAgIHJldHVybiBvcC5yZXRhaW47XG4gICAgICAgIH1cbiAgICAgICAgZWxzZSB7XG4gICAgICAgICAgICByZXR1cm4gdHlwZW9mIG9wLmluc2VydCA9PT0gJ3N0cmluZycgPyBvcC5pbnNlcnQubGVuZ3RoIDogMTtcbiAgICAgICAgfVxuICAgIH1cbiAgICBPcC5sZW5ndGggPSBsZW5ndGg7XG59KShPcCB8fCAoT3AgPSB7fSkpO1xuZXhwb3J0cy5kZWZhdWx0ID0gT3A7XG4vLyMgc291cmNlTWFwcGluZ1VSTD1PcC5qcy5tYXAiLCJcInVzZSBzdHJpY3RcIjtcbnZhciBfX2ltcG9ydERlZmF1bHQgPSAodGhpcyAmJiB0aGlzLl9faW1wb3J0RGVmYXVsdCkgfHwgZnVuY3Rpb24gKG1vZCkge1xuICAgIHJldHVybiAobW9kICYmIG1vZC5fX2VzTW9kdWxlKSA/IG1vZCA6IHsgXCJkZWZhdWx0XCI6IG1vZCB9O1xufTtcbnZhciBmYXN0X2RpZmZfMSA9IF9faW1wb3J0RGVmYXVsdChyZXF1aXJlKFwiZmFzdC1kaWZmXCIpKTtcbnZhciBsb2Rhc2hfY2xvbmVkZWVwXzEgPSBfX2ltcG9ydERlZmF1bHQocmVxdWlyZShcImxvZGFzaC5jbG9uZWRlZXBcIikpO1xudmFyIGxvZGFzaF9pc2VxdWFsXzEgPSBfX2ltcG9ydERlZmF1bHQocmVxdWlyZShcImxvZGFzaC5pc2VxdWFsXCIpKTtcbnZhciBBdHRyaWJ1dGVNYXBfMSA9IF9faW1wb3J0RGVmYXVsdChyZXF1aXJlKFwiLi9BdHRyaWJ1dGVNYXBcIikpO1xudmFyIE9wXzEgPSBfX2ltcG9ydERlZmF1bHQocmVxdWlyZShcIi4vT3BcIikpO1xudmFyIE5VTExfQ0hBUkFDVEVSID0gU3RyaW5nLmZyb21DaGFyQ29kZSgwKTsgLy8gUGxhY2Vob2xkZXIgY2hhciBmb3IgZW1iZWQgaW4gZGlmZigpXG52YXIgRGVsdGEgPSAvKiogQGNsYXNzICovIChmdW5jdGlvbiAoKSB7XG4gICAgZnVuY3Rpb24gRGVsdGEob3BzKSB7XG4gICAgICAgIC8vIEFzc3VtZSB3ZSBhcmUgZ2l2ZW4gYSB3ZWxsIGZvcm1lZCBvcHNcbiAgICAgICAgaWYgKEFycmF5LmlzQXJyYXkob3BzKSkge1xuICAgICAgICAgICAgdGhpcy5vcHMgPSBvcHM7XG4gICAgICAgIH1cbiAgICAgICAgZWxzZSBpZiAob3BzICE9IG51bGwgJiYgQXJyYXkuaXNBcnJheShvcHMub3BzKSkge1xuICAgICAgICAgICAgdGhpcy5vcHMgPSBvcHMub3BzO1xuICAgICAgICB9XG4gICAgICAgIGVsc2Uge1xuICAgICAgICAgICAgdGhpcy5vcHMgPSBbXTtcbiAgICAgICAgfVxuICAgIH1cbiAgICBEZWx0YS5wcm90b3R5cGUuaW5zZXJ0ID0gZnVuY3Rpb24gKGFyZywgYXR0cmlidXRlcykge1xuICAgICAgICB2YXIgbmV3T3AgPSB7fTtcbiAgICAgICAgaWYgKHR5cGVvZiBhcmcgPT09ICdzdHJpbmcnICYmIGFyZy5sZW5ndGggPT09IDApIHtcbiAgICAgICAgICAgIHJldHVybiB0aGlzO1xuICAgICAgICB9XG4gICAgICAgIG5ld09wLmluc2VydCA9IGFyZztcbiAgICAgICAgaWYgKGF0dHJpYnV0ZXMgIT0gbnVsbCAmJlxuICAgICAgICAgICAgdHlwZW9mIGF0dHJpYnV0ZXMgPT09ICdvYmplY3QnICYmXG4gICAgICAgICAgICBPYmplY3Qua2V5cyhhdHRyaWJ1dGVzKS5sZW5ndGggPiAwKSB7XG4gICAgICAgICAgICBuZXdPcC5hdHRyaWJ1dGVzID0gYXR0cmlidXRlcztcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gdGhpcy5wdXNoKG5ld09wKTtcbiAgICB9O1xuICAgIERlbHRhLnByb3RvdHlwZS5kZWxldGUgPSBmdW5jdGlvbiAobGVuZ3RoKSB7XG4gICAgICAgIGlmIChsZW5ndGggPD0gMCkge1xuICAgICAgICAgICAgcmV0dXJuIHRoaXM7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIHRoaXMucHVzaCh7IGRlbGV0ZTogbGVuZ3RoIH0pO1xuICAgIH07XG4gICAgRGVsdGEucHJvdG90eXBlLnJldGFpbiA9IGZ1bmN0aW9uIChsZW5ndGgsIGF0dHJpYnV0ZXMpIHtcbiAgICAgICAgaWYgKGxlbmd0aCA8PSAwKSB7XG4gICAgICAgICAgICByZXR1cm4gdGhpcztcbiAgICAgICAgfVxuICAgICAgICB2YXIgbmV3T3AgPSB7IHJldGFpbjogbGVuZ3RoIH07XG4gICAgICAgIGlmIChhdHRyaWJ1dGVzICE9IG51bGwgJiZcbiAgICAgICAgICAgIHR5cGVvZiBhdHRyaWJ1dGVzID09PSAnb2JqZWN0JyAmJlxuICAgICAgICAgICAgT2JqZWN0LmtleXMoYXR0cmlidXRlcykubGVuZ3RoID4gMCkge1xuICAgICAgICAgICAgbmV3T3AuYXR0cmlidXRlcyA9IGF0dHJpYnV0ZXM7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIHRoaXMucHVzaChuZXdPcCk7XG4gICAgfTtcbiAgICBEZWx0YS5wcm90b3R5cGUucHVzaCA9IGZ1bmN0aW9uIChuZXdPcCkge1xuICAgICAgICB2YXIgaW5kZXggPSB0aGlzLm9wcy5sZW5ndGg7XG4gICAgICAgIHZhciBsYXN0T3AgPSB0aGlzLm9wc1tpbmRleCAtIDFdO1xuICAgICAgICBuZXdPcCA9IGxvZGFzaF9jbG9uZWRlZXBfMS5kZWZhdWx0KG5ld09wKTtcbiAgICAgICAgaWYgKHR5cGVvZiBsYXN0T3AgPT09ICdvYmplY3QnKSB7XG4gICAgICAgICAgICBpZiAodHlwZW9mIG5ld09wLmRlbGV0ZSA9PT0gJ251bWJlcicgJiZcbiAgICAgICAgICAgICAgICB0eXBlb2YgbGFzdE9wLmRlbGV0ZSA9PT0gJ251bWJlcicpIHtcbiAgICAgICAgICAgICAgICB0aGlzLm9wc1tpbmRleCAtIDFdID0geyBkZWxldGU6IGxhc3RPcC5kZWxldGUgKyBuZXdPcC5kZWxldGUgfTtcbiAgICAgICAgICAgICAgICByZXR1cm4gdGhpcztcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIC8vIFNpbmNlIGl0IGRvZXMgbm90IG1hdHRlciBpZiB3ZSBpbnNlcnQgYmVmb3JlIG9yIGFmdGVyIGRlbGV0aW5nIGF0IHRoZSBzYW1lIGluZGV4LFxuICAgICAgICAgICAgLy8gYWx3YXlzIHByZWZlciB0byBpbnNlcnQgZmlyc3RcbiAgICAgICAgICAgIGlmICh0eXBlb2YgbGFzdE9wLmRlbGV0ZSA9PT0gJ251bWJlcicgJiYgbmV3T3AuaW5zZXJ0ICE9IG51bGwpIHtcbiAgICAgICAgICAgICAgICBpbmRleCAtPSAxO1xuICAgICAgICAgICAgICAgIGxhc3RPcCA9IHRoaXMub3BzW2luZGV4IC0gMV07XG4gICAgICAgICAgICAgICAgaWYgKHR5cGVvZiBsYXN0T3AgIT09ICdvYmplY3QnKSB7XG4gICAgICAgICAgICAgICAgICAgIHRoaXMub3BzLnVuc2hpZnQobmV3T3ApO1xuICAgICAgICAgICAgICAgICAgICByZXR1cm4gdGhpcztcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBpZiAobG9kYXNoX2lzZXF1YWxfMS5kZWZhdWx0KG5ld09wLmF0dHJpYnV0ZXMsIGxhc3RPcC5hdHRyaWJ1dGVzKSkge1xuICAgICAgICAgICAgICAgIGlmICh0eXBlb2YgbmV3T3AuaW5zZXJ0ID09PSAnc3RyaW5nJyAmJlxuICAgICAgICAgICAgICAgICAgICB0eXBlb2YgbGFzdE9wLmluc2VydCA9PT0gJ3N0cmluZycpIHtcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5vcHNbaW5kZXggLSAxXSA9IHsgaW5zZXJ0OiBsYXN0T3AuaW5zZXJ0ICsgbmV3T3AuaW5zZXJ0IH07XG4gICAgICAgICAgICAgICAgICAgIGlmICh0eXBlb2YgbmV3T3AuYXR0cmlidXRlcyA9PT0gJ29iamVjdCcpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHRoaXMub3BzW2luZGV4IC0gMV0uYXR0cmlidXRlcyA9IG5ld09wLmF0dHJpYnV0ZXM7XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIHRoaXM7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIGVsc2UgaWYgKHR5cGVvZiBuZXdPcC5yZXRhaW4gPT09ICdudW1iZXInICYmXG4gICAgICAgICAgICAgICAgICAgIHR5cGVvZiBsYXN0T3AucmV0YWluID09PSAnbnVtYmVyJykge1xuICAgICAgICAgICAgICAgICAgICB0aGlzLm9wc1tpbmRleCAtIDFdID0geyByZXRhaW46IGxhc3RPcC5yZXRhaW4gKyBuZXdPcC5yZXRhaW4gfTtcbiAgICAgICAgICAgICAgICAgICAgaWYgKHR5cGVvZiBuZXdPcC5hdHRyaWJ1dGVzID09PSAnb2JqZWN0Jykge1xuICAgICAgICAgICAgICAgICAgICAgICAgdGhpcy5vcHNbaW5kZXggLSAxXS5hdHRyaWJ1dGVzID0gbmV3T3AuYXR0cmlidXRlcztcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICByZXR1cm4gdGhpcztcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgICAgaWYgKGluZGV4ID09PSB0aGlzLm9wcy5sZW5ndGgpIHtcbiAgICAgICAgICAgIHRoaXMub3BzLnB1c2gobmV3T3ApO1xuICAgICAgICB9XG4gICAgICAgIGVsc2Uge1xuICAgICAgICAgICAgdGhpcy5vcHMuc3BsaWNlKGluZGV4LCAwLCBuZXdPcCk7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIHRoaXM7XG4gICAgfTtcbiAgICBEZWx0YS5wcm90b3R5cGUuY2hvcCA9IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgdmFyIGxhc3RPcCA9IHRoaXMub3BzW3RoaXMub3BzLmxlbmd0aCAtIDFdO1xuICAgICAgICBpZiAobGFzdE9wICYmIGxhc3RPcC5yZXRhaW4gJiYgIWxhc3RPcC5hdHRyaWJ1dGVzKSB7XG4gICAgICAgICAgICB0aGlzLm9wcy5wb3AoKTtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gdGhpcztcbiAgICB9O1xuICAgIERlbHRhLnByb3RvdHlwZS5maWx0ZXIgPSBmdW5jdGlvbiAocHJlZGljYXRlKSB7XG4gICAgICAgIHJldHVybiB0aGlzLm9wcy5maWx0ZXIocHJlZGljYXRlKTtcbiAgICB9O1xuICAgIERlbHRhLnByb3RvdHlwZS5mb3JFYWNoID0gZnVuY3Rpb24gKHByZWRpY2F0ZSkge1xuICAgICAgICB0aGlzLm9wcy5mb3JFYWNoKHByZWRpY2F0ZSk7XG4gICAgfTtcbiAgICBEZWx0YS5wcm90b3R5cGUubWFwID0gZnVuY3Rpb24gKHByZWRpY2F0ZSkge1xuICAgICAgICByZXR1cm4gdGhpcy5vcHMubWFwKHByZWRpY2F0ZSk7XG4gICAgfTtcbiAgICBEZWx0YS5wcm90b3R5cGUucGFydGl0aW9uID0gZnVuY3Rpb24gKHByZWRpY2F0ZSkge1xuICAgICAgICB2YXIgcGFzc2VkID0gW107XG4gICAgICAgIHZhciBmYWlsZWQgPSBbXTtcbiAgICAgICAgdGhpcy5mb3JFYWNoKGZ1bmN0aW9uIChvcCkge1xuICAgICAgICAgICAgdmFyIHRhcmdldCA9IHByZWRpY2F0ZShvcCkgPyBwYXNzZWQgOiBmYWlsZWQ7XG4gICAgICAgICAgICB0YXJnZXQucHVzaChvcCk7XG4gICAgICAgIH0pO1xuICAgICAgICByZXR1cm4gW3Bhc3NlZCwgZmFpbGVkXTtcbiAgICB9O1xuICAgIERlbHRhLnByb3RvdHlwZS5yZWR1Y2UgPSBmdW5jdGlvbiAocHJlZGljYXRlLCBpbml0aWFsVmFsdWUpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMub3BzLnJlZHVjZShwcmVkaWNhdGUsIGluaXRpYWxWYWx1ZSk7XG4gICAgfTtcbiAgICBEZWx0YS5wcm90b3R5cGUuY2hhbmdlTGVuZ3RoID0gZnVuY3Rpb24gKCkge1xuICAgICAgICByZXR1cm4gdGhpcy5yZWR1Y2UoZnVuY3Rpb24gKGxlbmd0aCwgZWxlbSkge1xuICAgICAgICAgICAgaWYgKGVsZW0uaW5zZXJ0KSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIGxlbmd0aCArIE9wXzEuZGVmYXVsdC5sZW5ndGgoZWxlbSk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBlbHNlIGlmIChlbGVtLmRlbGV0ZSkge1xuICAgICAgICAgICAgICAgIHJldHVybiBsZW5ndGggLSBlbGVtLmRlbGV0ZTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHJldHVybiBsZW5ndGg7XG4gICAgICAgIH0sIDApO1xuICAgIH07XG4gICAgRGVsdGEucHJvdG90eXBlLmxlbmd0aCA9IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMucmVkdWNlKGZ1bmN0aW9uIChsZW5ndGgsIGVsZW0pIHtcbiAgICAgICAgICAgIHJldHVybiBsZW5ndGggKyBPcF8xLmRlZmF1bHQubGVuZ3RoKGVsZW0pO1xuICAgICAgICB9LCAwKTtcbiAgICB9O1xuICAgIERlbHRhLnByb3RvdHlwZS5zbGljZSA9IGZ1bmN0aW9uIChzdGFydCwgZW5kKSB7XG4gICAgICAgIGlmIChzdGFydCA9PT0gdm9pZCAwKSB7IHN0YXJ0ID0gMDsgfVxuICAgICAgICBpZiAoZW5kID09PSB2b2lkIDApIHsgZW5kID0gSW5maW5pdHk7IH1cbiAgICAgICAgdmFyIG9wcyA9IFtdO1xuICAgICAgICB2YXIgaXRlciA9IE9wXzEuZGVmYXVsdC5pdGVyYXRvcih0aGlzLm9wcyk7XG4gICAgICAgIHZhciBpbmRleCA9IDA7XG4gICAgICAgIHdoaWxlIChpbmRleCA8IGVuZCAmJiBpdGVyLmhhc05leHQoKSkge1xuICAgICAgICAgICAgdmFyIG5leHRPcCA9IHZvaWQgMDtcbiAgICAgICAgICAgIGlmIChpbmRleCA8IHN0YXJ0KSB7XG4gICAgICAgICAgICAgICAgbmV4dE9wID0gaXRlci5uZXh0KHN0YXJ0IC0gaW5kZXgpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgZWxzZSB7XG4gICAgICAgICAgICAgICAgbmV4dE9wID0gaXRlci5uZXh0KGVuZCAtIGluZGV4KTtcbiAgICAgICAgICAgICAgICBvcHMucHVzaChuZXh0T3ApO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgaW5kZXggKz0gT3BfMS5kZWZhdWx0Lmxlbmd0aChuZXh0T3ApO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiBuZXcgRGVsdGEob3BzKTtcbiAgICB9O1xuICAgIERlbHRhLnByb3RvdHlwZS5jb21wb3NlID0gZnVuY3Rpb24gKG90aGVyKSB7XG4gICAgICAgIHZhciB0aGlzSXRlciA9IE9wXzEuZGVmYXVsdC5pdGVyYXRvcih0aGlzLm9wcyk7XG4gICAgICAgIHZhciBvdGhlckl0ZXIgPSBPcF8xLmRlZmF1bHQuaXRlcmF0b3Iob3RoZXIub3BzKTtcbiAgICAgICAgdmFyIG9wcyA9IFtdO1xuICAgICAgICB2YXIgZmlyc3RPdGhlciA9IG90aGVySXRlci5wZWVrKCk7XG4gICAgICAgIGlmIChmaXJzdE90aGVyICE9IG51bGwgJiZcbiAgICAgICAgICAgIHR5cGVvZiBmaXJzdE90aGVyLnJldGFpbiA9PT0gJ251bWJlcicgJiZcbiAgICAgICAgICAgIGZpcnN0T3RoZXIuYXR0cmlidXRlcyA9PSBudWxsKSB7XG4gICAgICAgICAgICB2YXIgZmlyc3RMZWZ0ID0gZmlyc3RPdGhlci5yZXRhaW47XG4gICAgICAgICAgICB3aGlsZSAodGhpc0l0ZXIucGVla1R5cGUoKSA9PT0gJ2luc2VydCcgJiZcbiAgICAgICAgICAgICAgICB0aGlzSXRlci5wZWVrTGVuZ3RoKCkgPD0gZmlyc3RMZWZ0KSB7XG4gICAgICAgICAgICAgICAgZmlyc3RMZWZ0IC09IHRoaXNJdGVyLnBlZWtMZW5ndGgoKTtcbiAgICAgICAgICAgICAgICBvcHMucHVzaCh0aGlzSXRlci5uZXh0KCkpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgaWYgKGZpcnN0T3RoZXIucmV0YWluIC0gZmlyc3RMZWZ0ID4gMCkge1xuICAgICAgICAgICAgICAgIG90aGVySXRlci5uZXh0KGZpcnN0T3RoZXIucmV0YWluIC0gZmlyc3RMZWZ0KTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgICB2YXIgZGVsdGEgPSBuZXcgRGVsdGEob3BzKTtcbiAgICAgICAgd2hpbGUgKHRoaXNJdGVyLmhhc05leHQoKSB8fCBvdGhlckl0ZXIuaGFzTmV4dCgpKSB7XG4gICAgICAgICAgICBpZiAob3RoZXJJdGVyLnBlZWtUeXBlKCkgPT09ICdpbnNlcnQnKSB7XG4gICAgICAgICAgICAgICAgZGVsdGEucHVzaChvdGhlckl0ZXIubmV4dCgpKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGVsc2UgaWYgKHRoaXNJdGVyLnBlZWtUeXBlKCkgPT09ICdkZWxldGUnKSB7XG4gICAgICAgICAgICAgICAgZGVsdGEucHVzaCh0aGlzSXRlci5uZXh0KCkpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgZWxzZSB7XG4gICAgICAgICAgICAgICAgdmFyIGxlbmd0aF8xID0gTWF0aC5taW4odGhpc0l0ZXIucGVla0xlbmd0aCgpLCBvdGhlckl0ZXIucGVla0xlbmd0aCgpKTtcbiAgICAgICAgICAgICAgICB2YXIgdGhpc09wID0gdGhpc0l0ZXIubmV4dChsZW5ndGhfMSk7XG4gICAgICAgICAgICAgICAgdmFyIG90aGVyT3AgPSBvdGhlckl0ZXIubmV4dChsZW5ndGhfMSk7XG4gICAgICAgICAgICAgICAgaWYgKHR5cGVvZiBvdGhlck9wLnJldGFpbiA9PT0gJ251bWJlcicpIHtcbiAgICAgICAgICAgICAgICAgICAgdmFyIG5ld09wID0ge307XG4gICAgICAgICAgICAgICAgICAgIGlmICh0eXBlb2YgdGhpc09wLnJldGFpbiA9PT0gJ251bWJlcicpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIG5ld09wLnJldGFpbiA9IGxlbmd0aF8xO1xuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgIGVsc2Uge1xuICAgICAgICAgICAgICAgICAgICAgICAgbmV3T3AuaW5zZXJ0ID0gdGhpc09wLmluc2VydDtcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICAvLyBQcmVzZXJ2ZSBudWxsIHdoZW4gY29tcG9zaW5nIHdpdGggYSByZXRhaW4sIG90aGVyd2lzZSByZW1vdmUgaXQgZm9yIGluc2VydHNcbiAgICAgICAgICAgICAgICAgICAgdmFyIGF0dHJpYnV0ZXMgPSBBdHRyaWJ1dGVNYXBfMS5kZWZhdWx0LmNvbXBvc2UodGhpc09wLmF0dHJpYnV0ZXMsIG90aGVyT3AuYXR0cmlidXRlcywgdHlwZW9mIHRoaXNPcC5yZXRhaW4gPT09ICdudW1iZXInKTtcbiAgICAgICAgICAgICAgICAgICAgaWYgKGF0dHJpYnV0ZXMpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIG5ld09wLmF0dHJpYnV0ZXMgPSBhdHRyaWJ1dGVzO1xuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgIGRlbHRhLnB1c2gobmV3T3ApO1xuICAgICAgICAgICAgICAgICAgICAvLyBPcHRpbWl6YXRpb24gaWYgcmVzdCBvZiBvdGhlciBpcyBqdXN0IHJldGFpblxuICAgICAgICAgICAgICAgICAgICBpZiAoIW90aGVySXRlci5oYXNOZXh0KCkgJiZcbiAgICAgICAgICAgICAgICAgICAgICAgIGxvZGFzaF9pc2VxdWFsXzEuZGVmYXVsdChkZWx0YS5vcHNbZGVsdGEub3BzLmxlbmd0aCAtIDFdLCBuZXdPcCkpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHZhciByZXN0ID0gbmV3IERlbHRhKHRoaXNJdGVyLnJlc3QoKSk7XG4gICAgICAgICAgICAgICAgICAgICAgICByZXR1cm4gZGVsdGEuY29uY2F0KHJlc3QpLmNob3AoKTtcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICAvLyBPdGhlciBvcCBzaG91bGQgYmUgZGVsZXRlLCB3ZSBjb3VsZCBiZSBhbiBpbnNlcnQgb3IgcmV0YWluXG4gICAgICAgICAgICAgICAgICAgIC8vIEluc2VydCArIGRlbGV0ZSBjYW5jZWxzIG91dFxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBlbHNlIGlmICh0eXBlb2Ygb3RoZXJPcC5kZWxldGUgPT09ICdudW1iZXInICYmXG4gICAgICAgICAgICAgICAgICAgIHR5cGVvZiB0aGlzT3AucmV0YWluID09PSAnbnVtYmVyJykge1xuICAgICAgICAgICAgICAgICAgICBkZWx0YS5wdXNoKG90aGVyT3ApO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gZGVsdGEuY2hvcCgpO1xuICAgIH07XG4gICAgRGVsdGEucHJvdG90eXBlLmNvbmNhdCA9IGZ1bmN0aW9uIChvdGhlcikge1xuICAgICAgICB2YXIgZGVsdGEgPSBuZXcgRGVsdGEodGhpcy5vcHMuc2xpY2UoKSk7XG4gICAgICAgIGlmIChvdGhlci5vcHMubGVuZ3RoID4gMCkge1xuICAgICAgICAgICAgZGVsdGEucHVzaChvdGhlci5vcHNbMF0pO1xuICAgICAgICAgICAgZGVsdGEub3BzID0gZGVsdGEub3BzLmNvbmNhdChvdGhlci5vcHMuc2xpY2UoMSkpO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiBkZWx0YTtcbiAgICB9O1xuICAgIERlbHRhLnByb3RvdHlwZS5kaWZmID0gZnVuY3Rpb24gKG90aGVyLCBjdXJzb3IpIHtcbiAgICAgICAgaWYgKHRoaXMub3BzID09PSBvdGhlci5vcHMpIHtcbiAgICAgICAgICAgIHJldHVybiBuZXcgRGVsdGEoKTtcbiAgICAgICAgfVxuICAgICAgICB2YXIgc3RyaW5ncyA9IFt0aGlzLCBvdGhlcl0ubWFwKGZ1bmN0aW9uIChkZWx0YSkge1xuICAgICAgICAgICAgcmV0dXJuIGRlbHRhXG4gICAgICAgICAgICAgICAgLm1hcChmdW5jdGlvbiAob3ApIHtcbiAgICAgICAgICAgICAgICBpZiAob3AuaW5zZXJ0ICE9IG51bGwpIHtcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIHR5cGVvZiBvcC5pbnNlcnQgPT09ICdzdHJpbmcnID8gb3AuaW5zZXJ0IDogTlVMTF9DSEFSQUNURVI7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIHZhciBwcmVwID0gZGVsdGEgPT09IG90aGVyID8gJ29uJyA6ICd3aXRoJztcbiAgICAgICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ2RpZmYoKSBjYWxsZWQgJyArIHByZXAgKyAnIG5vbi1kb2N1bWVudCcpO1xuICAgICAgICAgICAgfSlcbiAgICAgICAgICAgICAgICAuam9pbignJyk7XG4gICAgICAgIH0pO1xuICAgICAgICB2YXIgcmV0RGVsdGEgPSBuZXcgRGVsdGEoKTtcbiAgICAgICAgdmFyIGRpZmZSZXN1bHQgPSBmYXN0X2RpZmZfMS5kZWZhdWx0KHN0cmluZ3NbMF0sIHN0cmluZ3NbMV0sIGN1cnNvcik7XG4gICAgICAgIHZhciB0aGlzSXRlciA9IE9wXzEuZGVmYXVsdC5pdGVyYXRvcih0aGlzLm9wcyk7XG4gICAgICAgIHZhciBvdGhlckl0ZXIgPSBPcF8xLmRlZmF1bHQuaXRlcmF0b3Iob3RoZXIub3BzKTtcbiAgICAgICAgZGlmZlJlc3VsdC5mb3JFYWNoKGZ1bmN0aW9uIChjb21wb25lbnQpIHtcbiAgICAgICAgICAgIHZhciBsZW5ndGggPSBjb21wb25lbnRbMV0ubGVuZ3RoO1xuICAgICAgICAgICAgd2hpbGUgKGxlbmd0aCA+IDApIHtcbiAgICAgICAgICAgICAgICB2YXIgb3BMZW5ndGggPSAwO1xuICAgICAgICAgICAgICAgIHN3aXRjaCAoY29tcG9uZW50WzBdKSB7XG4gICAgICAgICAgICAgICAgICAgIGNhc2UgZmFzdF9kaWZmXzEuZGVmYXVsdC5JTlNFUlQ6XG4gICAgICAgICAgICAgICAgICAgICAgICBvcExlbmd0aCA9IE1hdGgubWluKG90aGVySXRlci5wZWVrTGVuZ3RoKCksIGxlbmd0aCk7XG4gICAgICAgICAgICAgICAgICAgICAgICByZXREZWx0YS5wdXNoKG90aGVySXRlci5uZXh0KG9wTGVuZ3RoKSk7XG4gICAgICAgICAgICAgICAgICAgICAgICBicmVhaztcbiAgICAgICAgICAgICAgICAgICAgY2FzZSBmYXN0X2RpZmZfMS5kZWZhdWx0LkRFTEVURTpcbiAgICAgICAgICAgICAgICAgICAgICAgIG9wTGVuZ3RoID0gTWF0aC5taW4obGVuZ3RoLCB0aGlzSXRlci5wZWVrTGVuZ3RoKCkpO1xuICAgICAgICAgICAgICAgICAgICAgICAgdGhpc0l0ZXIubmV4dChvcExlbmd0aCk7XG4gICAgICAgICAgICAgICAgICAgICAgICByZXREZWx0YS5kZWxldGUob3BMZW5ndGgpO1xuICAgICAgICAgICAgICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgICAgICAgICAgIGNhc2UgZmFzdF9kaWZmXzEuZGVmYXVsdC5FUVVBTDpcbiAgICAgICAgICAgICAgICAgICAgICAgIG9wTGVuZ3RoID0gTWF0aC5taW4odGhpc0l0ZXIucGVla0xlbmd0aCgpLCBvdGhlckl0ZXIucGVla0xlbmd0aCgpLCBsZW5ndGgpO1xuICAgICAgICAgICAgICAgICAgICAgICAgdmFyIHRoaXNPcCA9IHRoaXNJdGVyLm5leHQob3BMZW5ndGgpO1xuICAgICAgICAgICAgICAgICAgICAgICAgdmFyIG90aGVyT3AgPSBvdGhlckl0ZXIubmV4dChvcExlbmd0aCk7XG4gICAgICAgICAgICAgICAgICAgICAgICBpZiAobG9kYXNoX2lzZXF1YWxfMS5kZWZhdWx0KHRoaXNPcC5pbnNlcnQsIG90aGVyT3AuaW5zZXJ0KSkge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHJldERlbHRhLnJldGFpbihvcExlbmd0aCwgQXR0cmlidXRlTWFwXzEuZGVmYXVsdC5kaWZmKHRoaXNPcC5hdHRyaWJ1dGVzLCBvdGhlck9wLmF0dHJpYnV0ZXMpKTtcbiAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgICAgIGVsc2Uge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHJldERlbHRhLnB1c2gob3RoZXJPcCkuZGVsZXRlKG9wTGVuZ3RoKTtcbiAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBsZW5ndGggLT0gb3BMZW5ndGg7XG4gICAgICAgICAgICB9XG4gICAgICAgIH0pO1xuICAgICAgICByZXR1cm4gcmV0RGVsdGEuY2hvcCgpO1xuICAgIH07XG4gICAgRGVsdGEucHJvdG90eXBlLmVhY2hMaW5lID0gZnVuY3Rpb24gKHByZWRpY2F0ZSwgbmV3bGluZSkge1xuICAgICAgICBpZiAobmV3bGluZSA9PT0gdm9pZCAwKSB7IG5ld2xpbmUgPSAnXFxuJzsgfVxuICAgICAgICB2YXIgaXRlciA9IE9wXzEuZGVmYXVsdC5pdGVyYXRvcih0aGlzLm9wcyk7XG4gICAgICAgIHZhciBsaW5lID0gbmV3IERlbHRhKCk7XG4gICAgICAgIHZhciBpID0gMDtcbiAgICAgICAgd2hpbGUgKGl0ZXIuaGFzTmV4dCgpKSB7XG4gICAgICAgICAgICBpZiAoaXRlci5wZWVrVHlwZSgpICE9PSAnaW5zZXJ0Jykge1xuICAgICAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHZhciB0aGlzT3AgPSBpdGVyLnBlZWsoKTtcbiAgICAgICAgICAgIHZhciBzdGFydCA9IE9wXzEuZGVmYXVsdC5sZW5ndGgodGhpc09wKSAtIGl0ZXIucGVla0xlbmd0aCgpO1xuICAgICAgICAgICAgdmFyIGluZGV4ID0gdHlwZW9mIHRoaXNPcC5pbnNlcnQgPT09ICdzdHJpbmcnXG4gICAgICAgICAgICAgICAgPyB0aGlzT3AuaW5zZXJ0LmluZGV4T2YobmV3bGluZSwgc3RhcnQpIC0gc3RhcnRcbiAgICAgICAgICAgICAgICA6IC0xO1xuICAgICAgICAgICAgaWYgKGluZGV4IDwgMCkge1xuICAgICAgICAgICAgICAgIGxpbmUucHVzaChpdGVyLm5leHQoKSk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBlbHNlIGlmIChpbmRleCA+IDApIHtcbiAgICAgICAgICAgICAgICBsaW5lLnB1c2goaXRlci5uZXh0KGluZGV4KSk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBlbHNlIHtcbiAgICAgICAgICAgICAgICBpZiAocHJlZGljYXRlKGxpbmUsIGl0ZXIubmV4dCgxKS5hdHRyaWJ1dGVzIHx8IHt9LCBpKSA9PT0gZmFsc2UpIHtcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBpICs9IDE7XG4gICAgICAgICAgICAgICAgbGluZSA9IG5ldyBEZWx0YSgpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICAgIGlmIChsaW5lLmxlbmd0aCgpID4gMCkge1xuICAgICAgICAgICAgcHJlZGljYXRlKGxpbmUsIHt9LCBpKTtcbiAgICAgICAgfVxuICAgIH07XG4gICAgRGVsdGEucHJvdG90eXBlLmludmVydCA9IGZ1bmN0aW9uIChiYXNlKSB7XG4gICAgICAgIHZhciBpbnZlcnRlZCA9IG5ldyBEZWx0YSgpO1xuICAgICAgICB0aGlzLnJlZHVjZShmdW5jdGlvbiAoYmFzZUluZGV4LCBvcCkge1xuICAgICAgICAgICAgaWYgKG9wLmluc2VydCkge1xuICAgICAgICAgICAgICAgIGludmVydGVkLmRlbGV0ZShPcF8xLmRlZmF1bHQubGVuZ3RoKG9wKSk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBlbHNlIGlmIChvcC5yZXRhaW4gJiYgb3AuYXR0cmlidXRlcyA9PSBudWxsKSB7XG4gICAgICAgICAgICAgICAgaW52ZXJ0ZWQucmV0YWluKG9wLnJldGFpbik7XG4gICAgICAgICAgICAgICAgcmV0dXJuIGJhc2VJbmRleCArIG9wLnJldGFpbjtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGVsc2UgaWYgKG9wLmRlbGV0ZSB8fCAob3AucmV0YWluICYmIG9wLmF0dHJpYnV0ZXMpKSB7XG4gICAgICAgICAgICAgICAgdmFyIGxlbmd0aF8yID0gKG9wLmRlbGV0ZSB8fCBvcC5yZXRhaW4pO1xuICAgICAgICAgICAgICAgIHZhciBzbGljZSA9IGJhc2Uuc2xpY2UoYmFzZUluZGV4LCBiYXNlSW5kZXggKyBsZW5ndGhfMik7XG4gICAgICAgICAgICAgICAgc2xpY2UuZm9yRWFjaChmdW5jdGlvbiAoYmFzZU9wKSB7XG4gICAgICAgICAgICAgICAgICAgIGlmIChvcC5kZWxldGUpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGludmVydGVkLnB1c2goYmFzZU9wKTtcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICBlbHNlIGlmIChvcC5yZXRhaW4gJiYgb3AuYXR0cmlidXRlcykge1xuICAgICAgICAgICAgICAgICAgICAgICAgaW52ZXJ0ZWQucmV0YWluKE9wXzEuZGVmYXVsdC5sZW5ndGgoYmFzZU9wKSwgQXR0cmlidXRlTWFwXzEuZGVmYXVsdC5pbnZlcnQob3AuYXR0cmlidXRlcywgYmFzZU9wLmF0dHJpYnV0ZXMpKTtcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgICAgIHJldHVybiBiYXNlSW5kZXggKyBsZW5ndGhfMjtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHJldHVybiBiYXNlSW5kZXg7XG4gICAgICAgIH0sIDApO1xuICAgICAgICByZXR1cm4gaW52ZXJ0ZWQuY2hvcCgpO1xuICAgIH07XG4gICAgRGVsdGEucHJvdG90eXBlLnRyYW5zZm9ybSA9IGZ1bmN0aW9uIChhcmcsIHByaW9yaXR5KSB7XG4gICAgICAgIGlmIChwcmlvcml0eSA9PT0gdm9pZCAwKSB7IHByaW9yaXR5ID0gZmFsc2U7IH1cbiAgICAgICAgcHJpb3JpdHkgPSAhIXByaW9yaXR5O1xuICAgICAgICBpZiAodHlwZW9mIGFyZyA9PT0gJ251bWJlcicpIHtcbiAgICAgICAgICAgIHJldHVybiB0aGlzLnRyYW5zZm9ybVBvc2l0aW9uKGFyZywgcHJpb3JpdHkpO1xuICAgICAgICB9XG4gICAgICAgIHZhciBvdGhlciA9IGFyZztcbiAgICAgICAgdmFyIHRoaXNJdGVyID0gT3BfMS5kZWZhdWx0Lml0ZXJhdG9yKHRoaXMub3BzKTtcbiAgICAgICAgdmFyIG90aGVySXRlciA9IE9wXzEuZGVmYXVsdC5pdGVyYXRvcihvdGhlci5vcHMpO1xuICAgICAgICB2YXIgZGVsdGEgPSBuZXcgRGVsdGEoKTtcbiAgICAgICAgd2hpbGUgKHRoaXNJdGVyLmhhc05leHQoKSB8fCBvdGhlckl0ZXIuaGFzTmV4dCgpKSB7XG4gICAgICAgICAgICBpZiAodGhpc0l0ZXIucGVla1R5cGUoKSA9PT0gJ2luc2VydCcgJiZcbiAgICAgICAgICAgICAgICAocHJpb3JpdHkgfHwgb3RoZXJJdGVyLnBlZWtUeXBlKCkgIT09ICdpbnNlcnQnKSkge1xuICAgICAgICAgICAgICAgIGRlbHRhLnJldGFpbihPcF8xLmRlZmF1bHQubGVuZ3RoKHRoaXNJdGVyLm5leHQoKSkpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgZWxzZSBpZiAob3RoZXJJdGVyLnBlZWtUeXBlKCkgPT09ICdpbnNlcnQnKSB7XG4gICAgICAgICAgICAgICAgZGVsdGEucHVzaChvdGhlckl0ZXIubmV4dCgpKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGVsc2Uge1xuICAgICAgICAgICAgICAgIHZhciBsZW5ndGhfMyA9IE1hdGgubWluKHRoaXNJdGVyLnBlZWtMZW5ndGgoKSwgb3RoZXJJdGVyLnBlZWtMZW5ndGgoKSk7XG4gICAgICAgICAgICAgICAgdmFyIHRoaXNPcCA9IHRoaXNJdGVyLm5leHQobGVuZ3RoXzMpO1xuICAgICAgICAgICAgICAgIHZhciBvdGhlck9wID0gb3RoZXJJdGVyLm5leHQobGVuZ3RoXzMpO1xuICAgICAgICAgICAgICAgIGlmICh0aGlzT3AuZGVsZXRlKSB7XG4gICAgICAgICAgICAgICAgICAgIC8vIE91ciBkZWxldGUgZWl0aGVyIG1ha2VzIHRoZWlyIGRlbGV0ZSByZWR1bmRhbnQgb3IgcmVtb3ZlcyB0aGVpciByZXRhaW5cbiAgICAgICAgICAgICAgICAgICAgY29udGludWU7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIGVsc2UgaWYgKG90aGVyT3AuZGVsZXRlKSB7XG4gICAgICAgICAgICAgICAgICAgIGRlbHRhLnB1c2gob3RoZXJPcCk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIGVsc2Uge1xuICAgICAgICAgICAgICAgICAgICAvLyBXZSByZXRhaW4gZWl0aGVyIHRoZWlyIHJldGFpbiBvciBpbnNlcnRcbiAgICAgICAgICAgICAgICAgICAgZGVsdGEucmV0YWluKGxlbmd0aF8zLCBBdHRyaWJ1dGVNYXBfMS5kZWZhdWx0LnRyYW5zZm9ybSh0aGlzT3AuYXR0cmlidXRlcywgb3RoZXJPcC5hdHRyaWJ1dGVzLCBwcmlvcml0eSkpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gZGVsdGEuY2hvcCgpO1xuICAgIH07XG4gICAgRGVsdGEucHJvdG90eXBlLnRyYW5zZm9ybVBvc2l0aW9uID0gZnVuY3Rpb24gKGluZGV4LCBwcmlvcml0eSkge1xuICAgICAgICBpZiAocHJpb3JpdHkgPT09IHZvaWQgMCkgeyBwcmlvcml0eSA9IGZhbHNlOyB9XG4gICAgICAgIHByaW9yaXR5ID0gISFwcmlvcml0eTtcbiAgICAgICAgdmFyIHRoaXNJdGVyID0gT3BfMS5kZWZhdWx0Lml0ZXJhdG9yKHRoaXMub3BzKTtcbiAgICAgICAgdmFyIG9mZnNldCA9IDA7XG4gICAgICAgIHdoaWxlICh0aGlzSXRlci5oYXNOZXh0KCkgJiYgb2Zmc2V0IDw9IGluZGV4KSB7XG4gICAgICAgICAgICB2YXIgbGVuZ3RoXzQgPSB0aGlzSXRlci5wZWVrTGVuZ3RoKCk7XG4gICAgICAgICAgICB2YXIgbmV4dFR5cGUgPSB0aGlzSXRlci5wZWVrVHlwZSgpO1xuICAgICAgICAgICAgdGhpc0l0ZXIubmV4dCgpO1xuICAgICAgICAgICAgaWYgKG5leHRUeXBlID09PSAnZGVsZXRlJykge1xuICAgICAgICAgICAgICAgIGluZGV4IC09IE1hdGgubWluKGxlbmd0aF80LCBpbmRleCAtIG9mZnNldCk7XG4gICAgICAgICAgICAgICAgY29udGludWU7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBlbHNlIGlmIChuZXh0VHlwZSA9PT0gJ2luc2VydCcgJiYgKG9mZnNldCA8IGluZGV4IHx8ICFwcmlvcml0eSkpIHtcbiAgICAgICAgICAgICAgICBpbmRleCArPSBsZW5ndGhfNDtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIG9mZnNldCArPSBsZW5ndGhfNDtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gaW5kZXg7XG4gICAgfTtcbiAgICBEZWx0YS5PcCA9IE9wXzEuZGVmYXVsdDtcbiAgICBEZWx0YS5BdHRyaWJ1dGVNYXAgPSBBdHRyaWJ1dGVNYXBfMS5kZWZhdWx0O1xuICAgIHJldHVybiBEZWx0YTtcbn0oKSk7XG5tb2R1bGUuZXhwb3J0cyA9IERlbHRhO1xuLy8jIHNvdXJjZU1hcHBpbmdVUkw9RGVsdGEuanMubWFwIl0sIm5hbWVzIjpbImdsb2JhbCIsIl9faW1wb3J0RGVmYXVsdCIsInRoaXMiLCJsb2Rhc2hfY2xvbmVkZWVwXzEiLCJyZXF1aXJlJCQwIiwibG9kYXNoX2lzZXF1YWxfMSIsInJlcXVpcmUkJDEiLCJPcF8xIiwicmVxdWlyZSQkMiIsInJlcXVpcmUkJDMiXSwibWFwcGluZ3MiOiI7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Q0EwQkE7Q0FDQTtDQUNBO0NBQ0E7Q0FDQTtDQUNBLElBQUksV0FBVyxHQUFHLENBQUMsQ0FBQyxDQUFDO0NBQ3JCLElBQUksV0FBVyxHQUFHLENBQUMsQ0FBQztDQUNwQixJQUFJLFVBQVUsR0FBRyxDQUFDLENBQUM7QUFDbkI7QUFDQTtDQUNB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LE9BQU8sR0FBRyxFQUFFLENBQUMsQ0FBQyxDQUFDLENBQUM7Q0FDeEIsSUFBSSxJQUFJLE9BQU8sR0FBRyxFQUFFLENBQUMsQ0FBQyxDQUFDLENBQUM7Q0FDeEIsSUFBSSxJQUFJLE9BQU8sR0FBRyxFQUFFLENBQUMsQ0FBQyxDQUFDLENBQUM7Q0FDeEIsSUFBSSxJQUFJLE9BQU8sR0FBRyxFQUFFLENBQUMsQ0FBQyxDQUFDLENBQUM7Q0FDeEIsSUFBSSxJQUFJLFVBQVUsR0FBRyxFQUFFLENBQUMsQ0FBQyxDQUFDLENBQUM7Q0FDM0I7Q0FDQSxJQUFJLElBQUksT0FBTyxHQUFHLFNBQVMsQ0FBQyxPQUFPLEVBQUUsT0FBTyxDQUFDLENBQUM7Q0FDOUMsSUFBSSxJQUFJLE9BQU8sR0FBRyxTQUFTLENBQUMsT0FBTyxFQUFFLE9BQU8sQ0FBQyxDQUFDO0NBQzlDO0NBQ0EsSUFBSSxPQUFPLE9BQU8sQ0FBQyxNQUFNLENBQUMsQ0FBQyxDQUFDLFVBQVUsRUFBRSxVQUFVLENBQUMsQ0FBQyxFQUFFLE9BQU8sQ0FBQyxDQUFDO0NBQy9ELEdBQUc7QUFDSDtDQUNBLEVBQUUsT0FBTyxZQUFZLENBQUMsS0FBSyxFQUFFLEtBQUssQ0FBQyxDQUFDO0NBQ3BDLENBQ0E7QUFDQTtDQUNBO0NBQ0E7Q0FDQTtDQUNBO0NBQ0E7Q0FDQTtDQUNBO0NBQ0E7Q0FDQTtDQUNBLFNBQVMsWUFBWSxDQUFDLEtBQUssRUFBRSxLQUFLLEVBQUU7Q0FDcEM7Q0FDQSxFQUFFLElBQUksWUFBWSxHQUFHLEtBQUssQ0FBQyxNQUFNLENBQUM7Q0FDbEMsRUFBRSxJQUFJLFlBQVksR0FBRyxLQUFLLENBQUMsTUFBTSxDQUFDO0NBQ2xDLEVBQUUsSUFBSSxLQUFLLEdBQUcsSUFBSSxDQUFDLElBQUksQ0FBQyxDQUFDLFlBQVksR0FBRyxZQUFZLElBQUksQ0FBQyxDQUFDLENBQUM7Q0FDM0QsRUFBRSxJQUFJLFFBQVEsR0FBRyxLQUFLLENBQUM7Q0FDdkIsRUFBRSxJQUFJLFFBQVEsR0FBRyxDQUFDLEdBQUcsS0FBSyxDQUFDO0NBQzNC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LEVBQUU7Q0FDL0QsSUFBSSxPQUFPLENBQUMsQ0FBQztDQUNiLEdBQUc7Q0FDSDtDQUNBO0NBQ0EsRUFBRSxJQUFJLFVBQVUsR0FBRyxDQUFDLENBQUM7Q0FDckIsRUFBRSxJQUFJLFVBQVUsR0FBRyxJQUFJLENBQUMsR0FBRyxDQUFDLEtBQUssQ0FBQyxNQUFNLEVBQUUsS0FBSyxDQUFDLE1BQU0sQ0FBQyxDQUFDO0NBQ3hELEVBQUUsSUFBSSxVQUFVLEdBQUcsVUFBVSxDQUFDO0NBQzlCLEVBQUUsSUFBSSxVQUFVLEdBQUcsQ0FBQyxDQUFDO0NBQ3JCLEVBQUUsT0FBTyxVQUFVLEdBQUcsVUFBVSxFQUFFO0NBQ2xDLElBQUk7Q0FDSixNQUFNLEtBQUssQ0FBQyxTQUFTLENBQUMsS0FBSyxDQUFDLE1BQU0sR0FBRyxVQUFVLEVBQUUsS0FBSyxDQUFDLE1BQU0sR0FBRyxVQUFVLENBQUM7Q0FDM0UsTUFBTSxLQUFLLENBQUMsU0FBUyxDQUFDLEtBQUssQ0FBQyxNQUFNLEdBQUcsVUFBVSxFQUFFLEtBQUssQ0FBQyxNQUFNLEdBQUcsVUFBVSxDQUFDO0NBQzNFLE1BQU07Q0FDTixNQUFNLFVBQVUsR0FBRyxVQUFVLENBQUM7Q0FDOUIsTUFBTSxVQUFVLEdBQUcsVUFBVSxDQUFDO0NBQzlCLEtBQUssTUFBTTtDQUNYLE1BQU0sVUFBVSxHQUFHLFVBQVUsQ0FBQztDQUM5QixLQUFLO0NBQ0wsSUFBSSxVQUFVLEdBQUcsSUFBSSxDQUFDLEtBQUssQ0FBQyxDQUFDLFVBQVUsR0FBRyxVQUFVLElBQUksQ0FBQyxHQUFHLFVBQVUsQ0FBQyxDQUFDO0NBQ3hFLEdBQUc7QUFDSDtDQUNBLEVBQUUsSUFBSSxxQkFBcUIsQ0FBQyxLQUFLLENBQUMsVUFBVSxDQUFDLEtBQUssQ0FBQyxNQUFNLEdBQUcsVUFBVSxDQUFDLENBQUMsRUFBRTtDQUMxRSxJQUFJLFVBQVUsRUFBRSxDQUFDO0NBQ2pCLEdBQUc7QUFDSDtDQUNBLEVBQUUsT0FBTyxVQUFVLENBQUM7Q0FDcEIsQ0FDQTtBQUNBO0NBQ0E7Q0FDQTtDQUNBO0NB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QyxFQUFFO0NBQ2pFO0NBQ0EsUUFBUSxLQUFLLENBQUMsT0FBTyxDQUFDLENBQUMsQ0FBQyxDQUFDLEdBQUcsS0FBSyxDQUFDLE9BQU8sR0FBRyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUM7Q0FDakQsVUFBVSxLQUFLLENBQUMsT0FBTyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsU0FBUyxDQUFDLENBQUMsRUFBRSxLQUFLLENBQUMsT0FBTyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsTUFBTTtDQUNqRSxZQUFZLEtBQUssQ0FBQyxPQUFPLEdBQUcsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsTUFBTSxDQUFDLENBQUM7Q0FDMUMsUUFBUSxLQUFLLENBQUMsT0FBTyxHQUFHLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxHQUFHLEtBQUssQ0FBQyxPQUFPLEdBQUcsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLEdBQUcsS0FBSyxDQUFDLE9BQU8sR0FBRyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQztDQUM5RSxRQUFRLEtBQUssQ0FBQyxNQUFNLENBQUMsT0FBTyxHQUFHLENBQUMsRUFBRSxDQUFDLENBQUMsQ0FBQztDQUNyQyxRQUFRLE9BQU8sR0FBRyxJQUFJLENBQUM7Q0FDdkIsT0FBTyxNQUFNLElBQUksS0FBSyxDQUFDLE9BQU8sQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLFNBQVMsQ0FBQyxDQUFDLEVBQUUsS0FBSyxDQUFDLE9BQU8sR0FBRyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxNQUFNLENBQUM7Q0FDN0UsUUFBUSxLQUFLLENBQUMsT0FBTyxHQUFHLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxFQUFFO0NBQy9CO0NBQ0EsUUFBUSxLQUFLLENBQUMsT0FBTyxHQUFHLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxJQUFJLEtBQUssQ0FBQyxPQUFPLEdBQUcsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUM7Q0FDdkQsUUFBUSxLQUFLLENBQUMsT0FB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RSxJQUFJLElBQUksR0FBRyxJQUFJLENBQUMsUUFBUTtDQUMxQixNQUFNLEtBQUssR0FBRyxZQUFZLENBQUMsSUFBSSxFQUFFLEdBQUcsQ0FBQyxDQUFDO0FBQ3RDO0NBQ0EsRUFBRSxPQUFPLEtBQUssR0FBRyxDQUFDLEdBQUcsU0FBUyxHQUFHLElBQUksQ0FBQyxLQUFLLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQztDQUNoRCxDQUFDO0FBQ0Q7Q0FDQTtDQUNBO0NBQ0E7Q0FDQTtDQUNBO0NBQ0E7Q0FDQTtDQUNBO0NBQ0E7Q0FDQSxTQUFTLFlBQVksQ0FBQyxHQUFHLEVBQUU7Q0FDM0IsRUFBRSxPQUFPLFlBQVksQ0FBQyxJQUFJLENBQUMsUUFBUSxFQUFFLEdBQUcsQ0FBQyxHQUFHLENBQUMsQ0FBQyxDQUFDO0NBQy9DLENBQUM7QUFDRDtDQUNBO0NBQ0E7Q0FDQTtDQUNBO0NBQ0E7Q0FDQTtDQUNBO0NBQ0E7Q0FDQTtDQUNBO0NBQ0EsU0FBUyxZQUFZLENBQUMsR0FBRyxFQUFFLEtBQUssRUFBRTtDQUNsQyxFQUFFLElBQUksSUFBSSxHQUFHLElBQUksQ0FBQyxRQUFRO0NBQzFCLE1BQU0sS0FBSyxHQUFHLFlBQVksQ0FBQyxJQUFJLEVBQUUsR0FBRyxDQUFDLENBQUM7QUFDdEM7Q0FDQSxFQUFFLElBQUksS0FBSyxHQUFHLENBQUMsRUFBRTtDQUNqQixJQUFJLElBQUksQ0FBQyxJQUFJLENBQUMsQ0FBQyxHQUFHLEVBQUUsS0FBSyxDQUFDLENBQUMsQ0FBQztDQUM1QixHQUFHLE1BQU07Q0FDVCxJQUFJLElBQUksQ0FBQyxLQUFLLENBQUMsQ0FBQyxDQUFDLENBQUMsR0FBRyxLQUFLLENBQUM7Q0FDM0IsR0FBRztDQUNILEVBQUUsT0FBTyxJQUFJLENBQUM7Q0FDZCxDQUFDO0FBQ0Q7Q0FDQTtDQUNBLFNBQVMsQ0FBQyxTQUFTLENBQUMsS0FBSyxHQUFHLGNBQWMsQ0FBQztDQUMzQyxTQUFTLENBQUMsU0FBUyxDQUFDLFFBQVEsQ0FBQyxHQUFHLGVBQWUsQ0FBQztDQUNoRCxTQUFTLENBQUMs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QUUsSUFBSSxJQUFJLEdBQUcsS0FBSyxJQUFJLEtBQUssQ0FBQyxXQUFXO0NBQ3ZDLE1BQU0sS0FBSyxHQUFHLENBQUMsT0FBTyxJQUFJLElBQUksVUFBVSxJQUFJLElBQUksQ0FBQyxTQUFTLEtBQUssV0FBVyxDQUFDO0FBQzNFO0NBQ0EsRUFBRSxPQUFPLEtBQUssS0FBSyxLQUFLLENBQUM7Q0FDekIsQ0FBQztBQUNEO0NBQ0E7Q0FDQTtDQUNBO0NBQ0E7Q0FDQTtDQUNBO0NBQ0E7Q0FDQSxTQUFTLFFBQVEsQ0FBQyxJQUFJLEVBQUU7Q0FDeEIsRUFBRSxJQUFJLElBQUksSUFBSSxJQUFJLEVBQUU7Q0FDcEIsSUFBSSxJQUFJO0NBQ1IsTUFBTSxPQUFPLFlBQVksQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLENBQUM7Q0FDckMsS0FBSyxDQUFDLE9BQU8sQ0FBQyxFQUFFLEVBQUU7Q0FDbEIsSUFBSSxJQUFJO0NBQ1IsTUFBTSxRQUFRLElBQUksR0FBRyxFQUFFLEVBQUU7Q0FDekIsS0FBSyxDQUFDLE9BQU8sQ0FBQyxFQUFFLEVBQUU7Q0FDbEIsR0FBRztDQUNILEVBQUUsT0FBTyxFQUFFLENBQUM7Q0FDWixDQUFDO0FBQ0Q7Q0FDQTtDQUNBO0NBQ0E7Q0FDQTtDQUNBO0NBQ0E7Q0FDQTtDQUNBO0NBQ0E7Q0FDQTtDQUNBO0NBQ0E7Q0FDQTtDQUNBO0NBQ0E7Q0FDQTtDQUNBO0NBQ0E7Q0FDQSxTQUFTLFNBQVMsQ0FBQyxLQUFLLEVBQUU7Q0FDMUIsRUFBRSxPQUFPLFNBQVMsQ0FBQyxLQUFLLEVBQUUsSUFBSSxFQUFFLElBQUksQ0FBQyxDQUFDO0NBQ3RDLENBQUM7QUFDRDtDQUNBO0NBQ0E7Q0FDQTtDQUNBO0NBQ0E7Q0FDQTtDQUNBO0NBQ0E7Q0FDQTtDQUNBO0NBQ0E7Q0FDQTtDQUNBO0NBQ0E7Q0FDQTtDQUNBO0NBQ0E7Q0FDQTtDQUNBO0NBQ0E7Q0FDQTtDQUNBO0NBQ0E7Q0FDQTtDQUNBO0NBQ0E7Q0FDQTtDQUNBO0NBQ0E7Q0FDQTtDQUNBO0NBQ0E7Q0FDQSxTQUFTLEVBQUUsQ0FBQyxLQUFLLEVBQUUsS0FBSyxFQUFFO0NBQzFCLEVBQUUsT0FBTyxLQUFLLEtBQUssS0FBSyxLQUFLLEtBQUssS0FBSyxLQUFLLElBQUksS0FBSyxLQUFLLEtBQUssQ0FBQyxDQUFDO0NBQ2pFLENBQUM7QUFDRDtDQUNBO0NBQ0E7Q0FDQTtDQUNBO0NBQ0E7Q0FDQTtDQUNBO0NBQ0E7Q0FDQTtDQUNBO0NBQ0E7Q0FDQTtDQUNBO0NBQ0E7Q0FDQTtDQUNBO0NBQ0E7Q0FDQTtDQUNBLFNBQVMsV0FBVyxDQUFDLEtBQUssRUFBRTtDQUM1QjtDQUNBLEVBQUUsT0FBTyxpQkFBaUIsQ0FBQyxLQUFLLENBQUMsSUFBSSxjQUFjLENBQUMsSUFBSSxDQUFDLEtBQUssRUFBRSxRQUFRLENBQUM7Q0FDekUsS0FBSyxDQUFDLG9CQUFvQixDQUFDLElBQUksQ0FBQyxLQUFLLEVBQUUsUUFBUSxDQUFDLElBQUksY0FBYyxDQUFDLElBQUksQ0FBQyxLQUFLLENBQUMsSUFBSSxPQUFPLENBQUMsQ0FBQztDQUMzRixDQUFDO0FBQ0Q7Q0FDQTtDQUNBO0NBQ0E7Q0FDQTtDQUNBO0NBQ0E7Q0FDQTtDQUNBO0NBQ0E7Q0FDQTtDQUNBO0NBQ0E7Q0FDQTtDQUNBO0NBQ0E7Q0FDQTtDQUNBO0NBQ0E7Q0FDQTtDQUNBO0NBQ0E7Q0FDQTtDQUNBO0NBQ0EsSUFBSSxPQUFPLEdBQUcsS0FBSyxDQUFDLE9BQU8sQ0FBQztBQUM1QjtDQUNBO0NBQ0E7Q0FDQTtDQUNBO0NBQ0E7Q0FDQTtDQUNBO0NBQ0E7Q0FDQTtDQUNBO0NBQ0E7Q0FDQTtDQUNBO0NBQ0E7Q0FDQTtDQUNBO0NBQ0E7Q0FDQTtDQUNBO0NBQ0E7Q0FDQTtDQUNBO0NBQ0E7Q0FDQTtDQUNBO0NBQ0EsU0FBUyxXQUFXLENBQUMsS0FBSyxFQUFFO0NBQzVCLEVBQUUsT0FBTyxLQUFLLElBQUksSUFBSSxJQUFJLFFBQVEsQ0FBQyxLQUFLLENBQUMsTUFBTSxDQUFDLElBQUksQ0FBQyxVQUFVLENBQUMsS0FBSyxDQUFDLENBQUM7Q0FDdkUsQ0FBQztBQUNEO0NBQ0E7Q0FDQTtDQUNBO0NBQ0E7Q0FDQTtDQUNBO0NBQ0E7Q0FDQTtDQUNBO0NBQ0E7Q0FDQTtDQUNBO0NBQ0E7Q0FDQTtDQUNBO0NBQ0E7Q0FDQTtDQUNBO0NBQ0E7Q0FDQTtDQUNBO0NBQ0E7Q0FDQTtDQUNBO0NBQ0E7Q0FDQSxTQUFTLGlCQUFpQixDQUFDLEtBQUssRUFBRTtDQUNsQyxFQUFFLE9BQU8sWUFBWSxDQUFDLEtBQUssQ0FBQyxJQUFJLFdBQVcsQ0FBQyxLQUFLLENBQUMsQ0FBQztDQUNuRCxDQUFDO0FBQ0Q7Q0FDQTtDQUNBO0NBQ0E7Q0FDQTtDQUNBO0NBQ0E7Q0FDQTtDQUNBO0NBQ0E7Q0FDQTtDQUNBO0NBQ0E7Q0FDQTtDQUNBO0NBQ0E7Q0FDQTtDQUNBO0NBQ0EsSUFBSSxRQUFRLEdBQUcsY0FBYyxJQUFJLFNBQVMsQ0FBQztBQUMzQztDQUNBO0NBQ0E7Q0FDQTtDQUNBO0NBQ0E7Q0FDQTtDQUNBO0NBQ0E7Q0FDQTtDQUNBO0NBQ0E7Q0FDQTtDQUNBO0NBQ0E7Q0FDQTtDQUNBO0NBQ0E7Q0FDQSxTQUFTLFVBQVUsQ0FBQyxLQUFLLEVBQUU7Q0FDM0I7Q0FDQTtDQUNBLEVBQUUsSUFBSSxHQUFHLEdBQUcsUUFBUSxDQUFDLEtBQUssQ0FBQyxHQUFHLGNBQWMsQ0FBQyxJQUFJLENBQUMsS0FBSyxDQUFDLEdBQUcsRUFBRSxDQUFDO0NBQzlELEVBQUUsT0FBTyxHQUFHLElBQUksT0FBTyxJQUFJLEdBQUcsSUFBSSxNQUFNLENBQUM7Q0FDekMsQ0FBQztBQUNEO0NBQ0E7Q0FDQTtDQUNBO0NBQ0E7Q0FDQTtDQUNBO0NBQ0E7Q0FDQTtDQUNBO0NBQ0E7Q0FDQTtDQUNBO0NBQ0E7Q0FDQTtDQUNBO0NBQ0E7Q0FDQTtDQUNBO0NBQ0E7Q0FDQTtDQUNBO0NBQ0E7Q0FDQTtDQUNBO0NBQ0E7Q0FDQTtDQUNBLFNBQVMsUUFBUSxDQUFDLEtBQUssRUFBRTtDQUN6QixFQUFFLE9BQU8sT0FBTyxLQUFLLElBQUksUUFBUTtDQUNqQyxJQUFJLEtBQUssR0FBRyxDQUFDLENBQUMsSUFBSSxLQUFLLEdBQUcsQ0FBQyxJQUFJLENBQUMsSUFBSSxLQUFLLElBQUksZ0JBQWdCLENBQUM7Q0FDOUQsQ0FBQztBQUNEO0NBQ0E7Q0FDQTtDQUNBO0NBQ0E7Q0FDQTtDQUNBO0NBQ0E7Q0FDQTtDQUNBO0NBQ0E7Q0FDQTtDQUNBO0NBQ0E7Q0FDQTtDQUNBO0NBQ0E7Q0FDQTtDQUNBO0NBQ0E7Q0FDQTtDQUNBO0NBQ0E7Q0FDQTtDQUNBO0NBQ0E7Q0FDQSxTQUFTLFFBQVEsQ0FBQyxLQUFLLEVBQUU7Q0FDekIsRUFBRSxJQUFJLElBQUksR0FBRyxPQUFPLEtBQUssQ0FBQztDQUMxQixFQUFFLE9BQU8sQ0FBQyxDQUFDLEtBQUssS0FBSyxJQUFJLElBQUksUUFBUSxJQUFJLElBQUksSUFBSSxVQUFVLENBQUMsQ0FBQztDQUM3RCxDQUFDO0FBQ0Q7Q0FDQTtDQUNBO0NBQ0E7Q0FDQTtDQUNBO0NBQ0E7Q0FDQTtDQUNBO0NBQ0E7Q0FDQTtDQUNBO0NBQ0E7Q0FDQTtDQUNBO0NBQ0E7Q0FDQTtDQUNBO0NBQ0E7Q0FDQTtDQUNBO0NBQ0E7Q0FDQTtDQUNBO0NBQ0E7Q0FDQSxTQUFTLFlBQVksQ0FBQyxLQUFLLEVBQUU7Q0FDN0IsRUFBRSxPQUFPLENBQUMsQ0FBQyxLQUFLLElBQUksT0FBTyxLQUFLLElBQUksUUFBUSxDQUFDO0NBQzdDLENBQUM7QUFDRDtDQUNBO0NBQ0E7Q0FDQTtDQUNBO0NBQ0E7Q0FDQTtDQUNBO0NBQ0E7Q0FDQTtDQUNBO0NBQ0E7Q0FDQTtDQUNBO0NBQ0E7Q0FDQTtDQUNBO0NBQ0E7Q0FDQTtDQUNBO0NBQ0E7Q0FDQTtDQUNBO0NBQ0E7Q0FDQTtDQUNBO0NBQ0E7Q0FDQTtDQUNBO0NBQ0EsU0FBUyxJQUFJLENBQUMsTUFBTSxFQUFFO0NBQ3RCLEVBQUUsT0FBTyxXQUFXLENBQUMsTUFBTSxDQUFDLEdBQUcsYUFBYSxDQUFDLE1BQU0sQ0FBQyxHQUFHLFFBQVEsQ0FBQyxNQUFNLENBQUMsQ0FBQztDQUN4RSxDQUFDO0FBQ0Q7Q0FDQTtDQUNBO0NBQ0E7Q0FDQTtDQUNBO0NBQ0E7Q0FDQTtDQUNBO0NBQ0E7Q0FDQTtDQUNBO0NBQ0E7Q0FDQTtDQUNBO0NBQ0E7Q0FDQTtDQUNBO0NBQ0E7Q0FDQSxTQUFTLFNBQVMsR0FBRztDQUNyQixFQUFFLE9BQU8sRUFBRSxDQUFDO0NBQ1osQ0FBQztBQUNEO0NBQ0E7Q0FDQTtDQUNBO0NBQ0E7Q0FDQTtDQUNBO0NBQ0E7Q0FDQTtDQUNBO0NBQ0E7Q0FDQTtDQUNBO0NBQ0E7Q0FDQSxTQUFTLFNBQVMsR0FBRztDQUNyQixFQUFFLE9BQU8sS0FBSyxDQUFDO0NBQ2YsQ0FBQztBQUNEO0NBQ0EsaUJBQWlCLFNBQVM7Ozs7Ozs7Ozs7Ozs7Q0Mxc0QxQjtDQUNBLElBQUksZ0JBQWdCLEdBQUcsR0FBRyxDQUFDO0FBQzNCO0NBQ0E7Q0FDQSxJQUFJLGNBQWMsR0FBRywyQkFBMkIsQ0FBQztBQUNqRDtDQUNBO0NBQ0EsSUFBSSxvQkFBb0IsR0FBRyxDQUFDO0NBQzVCLElBQUksc0JBQXNCLEdBQUcsQ0FBQyxDQUFDO0FBQy9CO0NBQ0E7Q0FDQSxJQUFJLGdCQUFnQixHQUFHLGdCQUFnQixDQUFDO0FBQ3hDO0NBQ0E7Q0FDQSxJQUFJLE9BQU8sR0FBRyxvQkFBb0I7Q0FDbEMsSUFBSSxRQUFRLEdBQUcsZ0JBQWdCO0NBQy9CLElBQUksUUFBUSxHQUFHLHdCQUF3QjtDQUN2QyxJQUFJLE9BQU8sR0FBRyxrQkFBa0I7Q0FDaEMsSUFBSSxPQUFPLEdBQUcsZUFBZTtDQUM3QixJQUFJLFFBQVEsR0FBRyxnQkFBZ0I7Q0FDL0IsSUFBSSxPQUFPLEdBQUcsbUJBQW1CO0NBQ2pDLElBQUksTUFBTSxHQUFHLDRCQUE0QjtDQUN6QyxJQUFJLE1BQU0sR0FBRyxjQUFjO0NBQzNCLElBQUksU0FBUyxHQUFHLGlCQUFpQjtDQUNqQyxJQUFJLE9BQU8sR0FBRyxlQUFlO0NBQzdCLElBQUksU0FBUyxHQUFHLGlCQUFpQjtDQUNqQyxJQUFJLFVBQVUsR0FBRyxrQkFBa0I7Q0FDbkMsSUFBSSxRQUFRLEdBQUcsZ0JBQWdCO0NBQy9CLElBQUksU0FBUyxHQUFHLGlCQUFpQjtDQUNqQyxJQUFJLE1BQU0sR0FBRyxjQUFjO0NBQzNCLElBQUksU0FBUyxHQUFHLGlCQUFpQjtDQUNqQyxJQUFJLFNBQVMsR0FBRyxpQkFBaUI7Q0FDakMsSUFBSSxZQUFZLEdBQUcsb0JBQW9CO0NBQ3ZDLElBQUksVUFBVSxHQUFHLGtCQUFrQixDQUFDO0FBQ3BDO0NBQ0EsSUFBSSxjQUFjLEdBQUcsc0JBQXNCO0NBQzNDLElBQUksV0FBVyxHQUFHLG1CQUFtQjtDQUNyQyxJQUFJLFVBQVUsR0FBRyx1QkFBdUI7Q0FDeEMsSUFBSSxVQUFVLEdBQUcsdUJBQXVCO0NBQ3hDLElBQUksT0FBTyxHQUFHLG9CQUFvQjtDQUNsQyxJQUFJLFFBQVEsR0FBRyxxQkFBcUI7Q0FDcEMsSUFBSSxRQUFRLEdBQUcscUJBQXFCO0NBQ3BDLElBQUksUUFBUSxHQUFHLHFCQUFxQjtDQUNwQyxJQUFJLGVBQWUsR0FBRyw0QkFBNEI7Q0FDbEQsSUFBSSxTQUFTLEdBQUcsc0JBQXNCO0NBQ3RDLElBQUksU0FBUyxHQUFHLHNCQUFzQixDQUFDO0FBQ3ZDO0NBQ0E7Q0FDQTtDQUNBO0NBQ0E7Q0FDQSxJQUFJLFlBQVksR0FBRyxxQkFBcUIsQ0FBQztBQUN6QztDQUNBO0NBQ0EsSUFBSSxZQUFZLEdBQUcsNkJBQTZCLENBQUM7QUFDakQ7Q0FDQTtDQUNBLElBQUksUUFBUSxHQUFHLGtCQUFrQixDQUFDO0FBQ2xDO0NBQ0E7Q0FDQSxJQUFJLGNBQWMsR0FBRyxFQUFFLENBQUM7Q0FDeEIsY0FBYyxDQUFDLFVBQVUsQ0FBQyxHQUFHLGNBQWMsQ0FBQyxVQUFVLENBQUM7Q0FDdkQsY0FBYyxDQUFDLE9BQU8sQ0FBQyxHQUFHLGNBQWMsQ0FBQyxRQUFRLENBQUM7Q0FDbEQsY0FBYyxDQUFDLFFBQVEsQ0FBQyxHQUFHLGNBQWMsQ0FBQyxRQUFRLENBQUM7Q0FDbkQsY0FBYyxDQUFDLGVBQWUsQ0FBQyxHQUFHLGNBQWMsQ0FBQyxTQUFTLENBQUM7Q0FDM0QsY0FBYyxDQUFDLFNBQVMsQ0FBQyxHQUFHLElBQUksQ0FBQztDQUNqQyxjQUFjLENBQUMsT0FBTyxDQUFDLEdBQUcsY0FBYyxDQUFDLFFBQVEsQ0FBQztDQUNsRCxjQUFjLENBQUMsY0FBYyxDQUFDLEdBQUcsY0FBYyxDQUFDLE9BQU8sQ0FBQztDQUN4RCxjQUFjLENBQUMsV0FBVyxDQUFDLEdBQUcsY0FBYyxDQUFDLE9BQU8sQ0FBQztDQUNyRCxjQUFjLENBQUMsUUFBUSxDQUFDLEdBQUcsY0FBYyxDQUFDLE9BQU8sQ0FBQztDQUNsRCxjQUFjLENBQUMsTUFBTSxDQUFDLEdBQUcsY0FBYyxDQUFDLFNBQVMsQ0FBQztDQUNsRCxjQUFjLENBQUMsU0FBUyxDQUFDLEdBQUcsY0FBYyxDQUFDLFNBQVMsQ0FBQztDQUNyRCxjQUFjLENBQUMsTUFBTSxDQUFDLEdBQUcsY0FBYyxDQUFDLFNBQVMsQ0FBQztDQUNsRCxjQUFjLENBQUMsVUFBVSxDQUFDLEdBQUcsS0FBSyxDQUFDO0FBQ25DO0NBQ0E7Q0FDQSxJQUFJLFVBQVUsR0FBRyxPQUFPQSxjQUFNLElBQUksUUFBUSxJQUFJQSxjQUFNLElBQUlBLGNBQU0sQ0FBQyxNQUFNLEtBQUssTUFBTSxJQUFJQSxjQUFNLENBQUM7QUFDM0Y7Q0FDQTtDQUNBLElBQUksUUFBUSxHQUFHLE9BQU8sSUFBSSxJQUFJLFFBQVEsSUFBSSxJQUFJLElBQUksSUFBSSxDQUFDLE1BQU0sS0FBSyxNQUFNLElBQUksSUFBSSxDQUFDO0FBQ2pGO0NBQ0E7Q0FDQSxJQUFJLElBQUksR0FBRyxVQUFVLElBQUksUUFBUSxJQUFJLFFBQVEsQ0FBQyxhQUFhLENBQUMsRUFBRSxDQUFDO0FBQy9EO0NBQ0E7Q0FDQSxJQUFJLFdBQVcsR0FBaUMsT0FBTyxJQUFJLENBQUMsT0FBTyxDQUFDLFFBQVEsSUFBSSxPQUFPLENBQUM7QUFDeEY7Q0FDQTtDQUNBLElBQUksVUFBVSxHQUFHLFdBQVcsSUFBSSxRQUFhLElBQUksUUFBUSxJQUFJLE1BQU0sSUFBSSxDQUFDLE1BQU0sQ0FBQyxRQUFRLElBQUksTUFBTSxDQUFDO0FBQ2xHO0NBQ0E7Q0FDQSxJQUFJLGFBQWEsR0FBRyxVQUFVLElBQUksVUFBVSxDQUFDLE9BQU8sS0FBSyxXQUFXLENBQUM7QUFDckU7Q0FDQTtDQUNBLElBQUksV0FBVyxHQUFHLGFBQWEsSUFBSSxVQUFVLENBQUMsT0FBTyxDQUFDO0FBQ3REO0NBQ0E7Q0FDQSxJQUFJLFFBQVEsSUFBSSxXQUFXO0NBQzNCLEVBQUUsSUFBSTtDQUNOLElBQUksT0FBTyxXQUFXLElBQUksV0FBVyxDQUFDLE9BQU8sSUFBSSxXQUFXLENBQUMsT0FBTyxDQUFDLE1BQU0sQ0FBQyxDQUFDO0NBQzdFLEdBQUcsQ0FBQyxPQUFPLENBQUMsRUFBRSxFQUFFO0NBQ2hCLENBQUMsRUFBRSxDQUFDLENBQUM7QUFDTDtDQUNBO0NBQ0EsSUFBSSxnQkFBZ0IsR0FBRyxRQUFRLElBQUksUUFBUSxDQUFDLFlBQVksQ0FBQztBQUN6RDtDQUNBO0NBQ0E7Q0FDQTtDQUNBO0NBQ0E7Q0FDQTtDQUNBO0NBQ0E7Q0FDQTtDQUNBLFNBQVMsV0FBVyxDQUFDLEtBQUssRUFBRSxTQUFTLEVBQUU7Q0FDdkMsRUFBRSxJQUFJLEtBQUssR0FBRyxDQUFDLENBQUM7Q0FDaEIsTUFBTSxNQUFNLEdBQUcsS0FBSyxJQUFJLElBQUksR0FBRyxDQUFDLEdBQUcsS0FBSyxDQUFDLE1BQU07Q0FDL0MsTUFBTSxRQUFRLEdBQUcsQ0FBQztDQUNsQixNQUFNLE1BQU0sR0FBRyxFQUFFLENBQUM7QUFDbEI7Q0FDQSxFQUFFLE9BQU8sRUFBRSxLQUFLLEdBQUcsTUFBTSxFQUFFO0NBQzNCLElBQUksSUFBSSxLQUFLLEdBQUcsS0FBSyxDQUFDLEtBQUssQ0FBQyxDQUFDO0NBQzdCLElBQUksSUFBSSxTQUFTLENBQUMsS0FBSyxFQUFFLEtBQUssRUFBRSxLQUFLLENBQUMsRUFBRTtDQUN4QyxNQUFNLE1BQU0sQ0FBQyxRQUFRLEVBQUUsQ0FBQyxHQUFHLEtBQUssQ0FBQztDQUNqQyxLQUFLO0NBQ0wsR0FBRztDQUNILEVBQUUsT0FBTyxNQUFNLENBQUM7Q0FDaEIsQ0FBQztBQUNEO0NBQ0E7Q0FDQTtDQUNBO0NBQ0E7Q0FDQTtDQUNBO0NBQ0E7Q0FDQTtDQUNBLFNBQVMsU0FBUyxDQUFDLEtBQUssRUFBRSxNQUFNLEVBQUU7Q0FDbEMsRUFBRSxJQUFJLEtBQUssR0FBRyxDQUFDLENBQUM7Q0FDaEIsTUFBTSxNQUFNLEdBQUcsTUFBTSxDQUFDLE1BQU07Q0FDNUIsTUFBTSxNQUFNLEdBQUcsS0FBSyxDQUFDLE1BQU0sQ0FBQztBQUM1QjtDQUNBLEVBQUUsT0FBTyxFQUFFLEtBQUssR0FBRyxNQUFNLEVBQUU7Q0FDM0IsSUFBSSxLQUFLLENBQUMsTUFBTSxHQUFHLEtBQUssQ0FBQyxHQUFHLE1BQU0sQ0FBQyxLQUFLLENBQUMsQ0FBQztDQUMxQyxHQUFHO0NBQ0gsRUFBRSxPQUFPLEtBQUssQ0FBQztDQUNmLENBQUM7QUFDRDtDQUNBO0NBQ0E7Q0FDQTtDQUNBO0NBQ0E7Q0FDQTtDQUNBO0NBQ0E7Q0FDQTtDQUNBO0NBQ0EsU0FBUyxTQUFTLENBQUMsS0FBSyxFQUFFLFNBQVMsRUFBRTtDQUNyQyxFQUFFLElBQUksS0FBSyxHQUFHLENBQUMsQ0FBQztDQUNoQixNQUFNLE1BQU0sR0FBRyxLQUFLLElBQUksSUFBSSxHQUFHLENBQUMsR0FBRyxLQUFLLENBQUMsTUFBTSxDQUFDO0FBQ2hEO0NBQ0EsRUFBRSxPQUFPLEVBQUUsS0FBSyxHQUFHLE1BQU0sRUFBRTtDQUMzQixJQUFJLElBQUksU0FBUyxDQUFDLEtBQUssQ0FBQyxLQUFLLENBQUMsRUFBRSxLQUFLLEVBQUUsS0FBSyxDQUFDLEVBQUU7Q0FDL0MsTUFBTSxPQUFPLElBQUksQ0FBQztDQUNsQixLQUFLO0NBQ0wsR0FBRztDQUNILEVBQUUsT0FBTyxLQUFLLENBQUM7Q0FDZixDQUFDO0FBQ0Q7Q0FDQTtDQUNBO0NBQ0E7Q0FDQTtDQUNBO0NBQ0E7Q0FDQTtDQUNBO0NBQ0E7Q0FDQSxTQUFTLFNBQVMsQ0FBQyxDQUFDLEVBQUUsUUFBUSxFQUFFO0NBQ2hDLEVBQUUsSUFBSSxLQUFLLEdBQUcsQ0FBQyxDQUFDO0NBQ2hCLE1BQU0sTUFBTSxHQUFHLEtBQUssQ0FBQyxDQUFDLENBQUMsQ0FBQztBQUN4QjtDQUNBLEVBQUUsT0FBTyxFQUFFLEtBQUssR0FBRyxDQUFDLEVBQUU7Q0FDdEIsSUFBSSxNQUFNLENBQUMsS0FBSyxDQUFDLEdBQUcsUUFBUSxDQUFDLEtBQUssQ0FBQyxDQUFDO0NBQ3BDLEdBQUc7Q0FDSCxFQUFFLE9BQU8sTUFBTSxDQUFDO0NBQ2hCLENBQUM7QUFDRDtDQUNBO0NBQ0E7Q0FDQTtDQUNBO0NBQ0E7Q0FDQTtDQUNBO0NBQ0EsU0FBUyxTQUFTLENBQUMsSUFBSSxFQUFFO0NBQ3pCLEVBQUUsT0FBTyxTQUFTLEtBQUssRUFBRTtDQUN6QixJQUFJLE9BQU8sSUFBSSxDQUFDLEtBQUssQ0FBQyxDQUFDO0NBQ3ZCLEdBQUcsQ0FBQztDQUNKLENBQUM7QUFDRDtDQUNBO0NBQ0E7Q0FDQTtDQUNBO0NBQ0E7Q0FDQTtDQUNBO0NBQ0E7Q0FDQSxTQUFTLFFBQVEsQ0FBQyxLQUFLLEVBQUUsR0FBRyxFQUFFO0NBQzlCLEVBQUUsT0FBTyxLQUFLLENBQUMsR0FBRyxDQUFDLEdBQUcsQ0FBQyxDQUFDO0NBQ3hCLENBQUM7QUFDRDtDQUNBO0NBQ0E7Q0FDQTtDQUNBO0NBQ0E7Q0FDQTtDQUNBO0NBQ0E7Q0FDQSxTQUFTLFFBQVEsQ0FBQyxNQUFNLEVBQUUsR0FBRyxFQUFFO0NBQy9CLEVBQUUsT0FBTyxNQUFNLElBQUksSUFBSSxHQUFHLFNBQVMsR0FBRyxNQUFNLENBQUMsR0FBRyxDQUFDLENBQUM7Q0FDbEQsQ0FBQztBQUNEO0NBQ0E7Q0FDQTtDQUNBO0NBQ0E7Q0FDQTtDQUNBO0NBQ0E7Q0FDQSxTQUFTLFVBQVUsQ0FBQyxHQUFHLEVBQUU7Q0FDekIsRUFBRSxJQUFJLEtBQUssR0FBRyxDQUFDLENBQUM7Q0FDaEIsTUFBTSxNQUFNLEdBQUcsS0FBSyxDQUFDLEdBQUcsQ0FBQyxJQUFJLENBQUMsQ0FBQztBQUMvQjtDQUNBLEVBQUUsR0FBRyxDQUFDLE9BQU8sQ0FBQyxTQUFTLEtBQUssRUFBRSxHQUFHLEVBQUU7Q0FDbkMsSUFBSSxNQUFNLENBQUMsRUFBRSxLQUFLLENBQUMsR0FBRyxDQUFDLEdBQUcsRUFBRSxLQUFLLENBQUMsQ0FBQztDQUNuQyxHQUFHLENBQUMsQ0FBQztDQUNMLEVBQUUsT0FBTyxNQUFNLENBQUM7Q0FDaEIsQ0FBQztBQUNEO0NBQ0E7Q0FDQTtDQUNBO0NBQ0E7Q0FDQTtDQUNBO0NBQ0E7Q0FDQTtDQUNBLFNBQVMsT0FBTyxDQUFDLElBQUksRUFBRSxTQUFTLEVBQUU7Q0FDbEMsRUFBRSxPQUFPLFNBQVMsR0FBRyxFQUFFO0NBQ3ZCLElBQUksT0FBTyxJQUFJLENBQUMsU0FBUyxDQUFDLEdBQUcsQ0FBQyxDQUFDLENBQUM7Q0FDaEMsR0FBRyxDQUFDO0NBQ0osQ0FBQztBQUNEO0NBQ0E7Q0FDQTtDQUNBO0NBQ0E7Q0FDQTtDQUNBO0NBQ0E7Q0FDQSxTQUFTLFVBQVUsQ0FBQyxHQUFHLEVBQUU7Q0FDekIsRUFBRSxJQUFJLEtBQUssR0FBRyxDQUFDLENBQUM7Q0FDaEIsTUFBTSxNQUFNLEdBQUcsS0FBSyxDQUFDLEdBQUcsQ0FBQyxJQUFJLENBQUMsQ0FBQztBQUMvQjtDQUNBLEVBQUUsR0FBRyxDQUFDLE9BQU8sQ0FBQyxTQUFTLEtBQUssRUFBRTtDQUM5QixJQUFJLE1BQU0sQ0FBQyxFQUFFLEtBQUssQ0FBQyxHQUFHLEtBQUssQ0FBQztDQUM1QixHQUFHLENBQUMsQ0FBQztDQUNMLEVBQUUsT0FBTyxNQUFNLENBQUM7Q0FDaEIsQ0FBQztBQUNEO0NBQ0E7Q0FDQSxJQUFJLFVBQVUsR0FBRyxLQUFLLENBQUMsU0FBUztDQUNoQyxJQUFJLFNBQVMsR0FBRyxRQUFRLENBQUMsU0FBUztDQUNsQyxJQUFJLFdBQVcsR0FBRyxNQUFNLENBQUMsU0FBUyxDQUFDO0FBQ25DO0NBQ0E7Q0FDQSxJQUFJLFVBQVUsR0FBRyxJQUFJLENBQUMsb0JBQW9CLENBQUMsQ0FBQztBQUM1QztDQUNBO0NBQ0EsSUFBSSxZQUFZLEdBQUcsU0FBUyxDQUFDLFFBQVEsQ0FBQztBQUN0QztDQUNBO0NBQ0EsSUFBSSxjQUFjLEdBQUcsV0FBVyxDQUFDLGNBQWMsQ0FBQztBQUNoRDtDQUNBO0NBQ0EsSUFBSSxVQUFVLElBQUksV0FBVztDQUM3QixFQUFFLElBQUksR0FBRyxHQUFHLFFBQVEsQ0FBQyxJQUFJLENBQUMsVUFBVSxJQUFJLFVBQVUsQ0FBQyxJQUFJLElBQUksVUFBVSxDQUFDLElBQUksQ0FBQyxRQUFRLElBQUksRUFBRSxDQUFDLENBQUM7Q0FDM0YsRUFBRSxPQUFPLEdBQUcsSUFBSSxnQkFBZ0IsR0FBRyxHQUFHLElBQUksRUFBRSxDQUFDO0NBQzdDLENBQUMsRUFBRSxDQUFDLENBQUM7QUFDTDtDQUNBO0NBQ0E7Q0FDQTtDQUNBO0NBQ0E7Q0FDQSxJQUFJLG9CQUFvQixHQUFHLFdBQVcsQ0FBQyxRQUFRLENBQUM7QUFDaEQ7Q0FDQTtDQUNBLElBQUksVUFBVSxHQUFHLE1BQU0sQ0FBQyxHQUFHO0NBQzNCLEVBQUUsWUFBWSxDQUFDLElBQUksQ0FBQyxjQUFjLENBQUMsQ0FBQyxPQUFPLENBQUMsWUFBWSxFQUFFLE1BQU0sQ0FBQztDQUNqRSxHQUFHLE9BQU8sQ0FBQyx3REFBd0QsRUFBRSxPQUFPLENBQUMsR0FBRyxHQUFHO0NBQ25GLENBQUMsQ0FBQztBQUNGO0NBQ0E7Q0FDQSxJQUFJLE1BQU0sR0FBRyxhQUFhLEdBQUcsSUFBSSxDQUFDLE1BQU0sR0FBRyxTQUFTO0NBQ3BELElBQUksTUFBTSxHQUFHLElBQUksQ0FBQyxNQUFNO0NBQ3hCLElBQUksVUFBVSxHQUFHLElBQUksQ0FBQyxVQUFVO0NBQ2hDLElBQUksb0JBQW9CLEdBQUcsV0FBVyxDQUFDLG9CQUFvQjtDQUMzRCxJQUFJLE1BQU0sR0FBRyxVQUFVLENBQUMsTUFBTTtDQUM5QixJQUFJLGNBQWMsR0FBRyxNQUFNLEdBQUcsTUFBTSxDQUFDLFdBQVcsR0FBRyxTQUFTLENBQUM7QUFDN0Q7Q0FDQTtDQUNBLElBQUksZ0JBQWdCLEdBQUcsTUFBTSxDQUFDLHFCQUFxQjtDQUNuRCxJQUFJLGNBQWMsR0FBRyxNQUFNLEdBQUcsTUFBTSxDQUFDLFFBQVEsR0FBRyxTQUFTO0NBQ3pELElBQUksVUFBVSxHQUFHLE9BQU8sQ0FBQyxNQUFNLENBQUMsSUFBSSxFQUFFLE1BQU0sQ0FBQyxDQUFDO0FBQzlDO0NBQ0E7Q0FDQSxJQUFJLFFBQVEsR0FBRyxTQUFTLENBQUMsSUFBSSxFQUFFLFVBQVUsQ0FBQztDQUMxQyxJQUFJLEdBQUcsR0FBRyxTQUFTLENBQUMsSUFBSSxFQUFFLEtBQUssQ0FBQztDQUNoQyxJQUFJLE9BQU8sR0FBRyxTQUFTLENBQUMsSUFBSSxFQUFFLFNBQVMsQ0FBQztDQUN4QyxJQUFJLEdBQUcsR0FBRyxTQUFTLENBQUMsSUFBSSxFQUFFLEtBQUssQ0FBQztDQUNoQyxJQUFJLE9BQU8sR0FBRyxTQUFTLENBQUMsSUFBSSxFQUFFLFNBQVMsQ0FBQztDQUN4QyxJQUFJLFlBQVksR0FBRyxTQUFTLENBQUMsTUFBTSxFQUFFLFFBQVEsQ0FBQyxDQUFDO0FBQy9DO0NBQ0E7Q0FDQSxJQUFJLGtCQUFrQixHQUFHLFFBQVEsQ0FBQyxRQUFRLENBQUM7Q0FDM0MsSUFBSSxhQUFhLEdBQUcsUUFBUSxDQUFDLEdBQUcsQ0FBQztDQUNqQyxJQUFJLGlCQUFpQixHQUFHLFFBQVEsQ0FBQyxPQUFPLENBQUM7Q0FDekMsSUFBSSxhQUFhLEdBQUcsUUFBUSxDQUFDLEdBQUcsQ0FBQztDQUNqQyxJQUFJLGlCQUFpQixHQUFHLFFBQVEsQ0FBQyxPQUFPLENBQUMsQ0FBQztBQUMxQztDQUNBO0NBQ0EsSUFBSSxXQUFXLEdBQUcsTUFBTSxHQUFHLE1BQU0sQ0FBQyxTQUFTLEdBQUcsU0FBUztDQUN2RCxJQUFJLGFBQWEsR0FBRyxXQUFXLEdBQUcsV0FBVyxDQUFDLE9BQU8sR0FBRyxTQUFTLENBQUM7QUFDbEU7Q0FDQTtDQUNBO0NBQ0E7Q0FDQTtDQUNBO0NBQ0E7Q0FDQTtDQUNBLFNBQVMsSUFBSSxDQUFDLE9BQU8sRUFBRTtDQUN2QixFQUFFLElBQUksS0FBSyxHQUFHLENBQUMsQ0FBQztDQUNoQixNQUFNLE1BQU0sR0FBRyxPQUFPLElBQUksSUFBSSxHQUFHLENBQUMsR0FBRyxPQUFPLENBQUMsTUFBTSxDQUFDO0FBQ3BEO0NBQ0EsRUFBRSxJQUFJLENBQUMsS0FBSyxFQUFFLENBQUM7Q0FDZixFQUFFLE9BQU8sRUFBRSxLQUFLLEdBQUcsTUFBTSxFQUFFO0NBQzNCLElBQUksSUFBSSxLQUFLLEdBQUcsT0FBTyxDQUFDLEtBQUssQ0FBQyxDQUFDO0NBQy9CLElBQUksSUFBSSxDQUFDLEdBQUcsQ0FBQyxLQUFLLENBQUMsQ0FBQyxDQUFDLEVBQUUsS0FBSyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUM7Q0FDakMsR0FBRztDQUNILENBQUM7QUFDRDtDQUNBO0NBQ0E7Q0FDQTtDQUNBO0NBQ0E7Q0FDQTtDQUNBO0NBQ0EsU0FBUyxTQUFTLEdBQUc7Q0FDckIsRUFBRSxJQUFJLENBQUMsUUFBUSxHQUFHLFlBQVksR0FBRyxZQUFZLENBQUMsSUFBSSxDQUFDLEdBQUcsRUFBRSxDQUFDO0NBQ3pELEVBQUUsSUFBSSxDQUFDLElBQUksR0FBRyxDQUFDLENBQUM7Q0FDaEIsQ0FBQztBQUNEO0NBQ0E7Q0FDQTtDQUNBO0NBQ0E7Q0FDQTtDQUNBO0NBQ0E7Q0FDQTtDQUNBO0NBQ0E7Q0FDQSxTQUFTLFVBQVUsQ0FBQyxHQUFHLEVBQUU7Q0FDekIsRUFBRSxJQUFJLE1BQU0sR0FBRyxJQUFJLENBQUMsR0FBRyxDQUFDLEdBQUcsQ0FBQyxJQUFJLE9BQU8sSUFBSSxDQUFDLFFBQVEsQ0FBQyxHQUFHLENBQUMsQ0FBQztDQUMxRCxFQUFFLElBQUksQ0FBQyxJQUFJLElBQUksTUFBTSxHQUFHLENBQUMsR0FBRyxDQUFDLENBQUM7Q0FDOUIsRUFBRSxPQUFPLE1BQU0sQ0FBQztDQUNoQixDQUFDO0FBQ0Q7Q0FDQTtDQUNBO0NBQ0E7Q0FDQTtDQUNBO0NBQ0E7Q0FDQTtDQUNBO0NBQ0E7Q0FDQSxTQUFTLE9BQU8sQ0FBQyxHQUFHLEVBQUU7Q0FDdEIsRUFBRSxJQUFJLElBQUksR0FBRyxJQUFJLENBQUMsUUFBUSxDQUFDO0NBQzNCLEVBQUUsSUFBSSxZQUFZLEVBQUU7Q0FDcEIsSUFBSSxJQUFJLE1BQU0sR0FBRyxJQUFJLENBQUMsR0FBRyxDQUFDLENBQUM7Q0FDM0IsSUFBSSxPQUFPLE1BQU0sS0FBSyxjQUFjLEdBQUcsU0FBUyxHQUFHLE1BQU0sQ0FBQztDQUMxRCxHQUFHO0NBQ0gsRUFBRSxPQUFPLGNBQWMsQ0FBQyxJQUFJLENBQUMsSUFBSSxFQUFFLEdBQUcsQ0FBQyxHQUFHLElBQUksQ0FBQyxHQUFHLENBQUMsR0FBRyxTQUFTLENBQUM7Q0FDaEUsQ0FBQztBQUNEO0NBQ0E7Q0FDQTtDQUNBO0NBQ0E7Q0FDQTtDQUNBO0NBQ0E7Q0FDQTtDQUNBO0NBQ0EsU0FBUyxPQUFPLENBQUMsR0FBRyxFQUFFO0NBQ3RCLEVBQUUsSUFBSSxJQUFJLEdBQUcsSUFBSSxDQUFDLFFBQVEsQ0FBQztDQUMzQixFQUFFLE9BQU8sWUFBWSxJQUFJLElBQUksQ0FBQyxHQUFHLENBQUMsS0FBSyxTQUFTLElBQUksY0FBYyxDQUFDLElBQUksQ0FBQyxJQUFJLEVBQUUsR0FBRyxDQUFDLENBQUM7Q0FDbkYsQ0FBQztBQUNEO0NBQ0E7Q0FDQTtDQUNBO0NBQ0E7Q0FDQTtDQUNBO0NBQ0E7Q0FDQTtDQUNBO0NBQ0E7Q0FDQSxTQUFTLE9BQU8sQ0FBQyxHQUFHLEVBQUUsS0FBSyxFQUFFO0NBQzdCLEVBQUUsSUFBSSxJQUFJLEdBQUcsSUFBSSxDQUFDLFFBQVEsQ0FBQztDQUMzQixFQUFFLElBQUksQ0FBQyxJQUFJLElBQUksSUFBSSxDQUFDLEdBQUcsQ0FBQyxHQUFHLENBQUMsR0FBRyxDQUFDLEdBQUcsQ0FBQyxDQUFDO0NBQ3JDLEVBQUUsSUFBSSxDQUFDLEdBQUcsQ0FBQyxHQUFHLENBQUMsWUFBWSxJQUFJLEtBQUssS0FBSyxTQUFTLElBQUksY0FBYyxHQUFHLEtBQUssQ0FBQztDQUM3RSxFQUFFLE9BQU8sSUFBSSxDQUFDO0NBQ2QsQ0FBQztBQUNEO0NBQ0E7Q0FDQSxJQUFJLENBQUMsU0FBUyxDQUFDLEtBQUssR0FBRyxTQUFTLENBQUM7Q0FDakMsSUFBSSxDQUFDLFNBQVMsQ0FBQyxRQUFRLENBQUMsR0FBRyxVQUFVLENBQUM7Q0FDdEMsSUFBSSxDQUFDLFNBQVMsQ0FBQyxHQUFHLEdBQUcsT0FBTyxDQUFDO0NBQzdCLElBQUksQ0FBQyxTQUFTLENBQUMsR0FBRyxHQUFHLE9BQU8sQ0FBQztDQUM3QixJQUFJLENBQUMsU0FBUyxDQUFDLEdBQUcsR0FBRyxPQUFPLENBQUM7QUFDN0I7Q0FDQTtDQUNBO0NBQ0E7Q0FDQTtDQUNBO0NBQ0E7Q0FDQTtDQUNBLFNBQVMsU0FBUyxDQUFDLE9BQU8sRUFBRTtDQUM1QixFQUFFLElBQUksS0FBSyxHQUFHLENBQUMsQ0FBQztDQUNoQixNQUFNLE1BQU0sR0FBRyxPQUFPLElBQUksSUFBSSxHQUFHLENBQUMsR0FBRyxPQUFPLENBQUMsTUFBTSxDQUFDO0FBQ3BEO0NBQ0EsRUFBRSxJQUFJLENBQUMsS0FBSyxFQUFFLENBQUM7Q0FDZixFQUFFLE9BQU8sRUFBRSxLQUFLLEdBQUcsTUFBTSxFQUFFO0NBQzNCLElBQUksSUFBSSxLQUFLLEdBQUcsT0FBTyxDQUFDLEtBQUssQ0FBQyxDQUFDO0NBQy9CLElBQUksSUFBSSxDQUFDLEdBQUcsQ0FBQyxLQUFLLENBQUMsQ0FBQyxDQUFDLEVBQUUsS0FBSyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUM7Q0FDakMsR0FBRztDQUNILENBQUM7QUFDRDtDQUNBO0NBQ0E7Q0FDQTtDQUNBO0NBQ0E7Q0FDQTtDQUNBO0NBQ0EsU0FBUyxjQUFjLEdBQUc7Q0FDMUIsRUFBRSxJQUFJLENBQUMsUUFBUSxHQUFHLEVBQUUsQ0FBQztDQUNyQixFQUFFLElBQUksQ0FBQyxJQUFJLEdBQUcsQ0FBQyxDQUFDO0NBQ2hCLENBQUM7QUFDRDtDQUNBO0NBQ0E7Q0FDQTtDQUNBO0NBQ0E7Q0FDQTtDQUNBO0NBQ0E7Q0FDQTtDQUNBLFNBQVMsZUFBZSxDQUFDLEdBQUcsRUFBRTtDQUM5QixFQUFFLElBQUksSUFBSSxHQUFHLElBQUksQ0FBQyxRQUFRO0NBQzFCLE1BQU0sS0FBSyxHQUFHLFlBQVksQ0FBQyxJQUFJLEVBQUUsR0FBRyxDQUFDLENBQUM7QUFDdEM7Q0FDQSxFQUFFLElBQUksS0FBSyxHQUFHLENBQUMsRUFBRTtDQUNqQixJQUFJLE9BQU8sS0FBSyxDQUFDO0NBQ2pCLEdBQUc7Q0FDSCxFQUFFLElBQUksU0FBUyxHQUFHLElBQUksQ0FBQyxNQUFNLEdBQUcsQ0FBQyxDQUFDO0NBQ2xDLEVBQUUsSUFBSSxLQUFLLElBQUksU0FBUyxFQUFFO0NBQzFCLElBQUksSUFBSSxDQUFDLEdBQUcsRUFBRSxDQUFDO0NBQ2YsR0FBRyxNQUFNO0NBQ1QsSUFBSSxNQUFNLENBQUMsSUFBSSxDQUFDLElBQUksRUFBRSxLQUFLLEVBQUUsQ0FBQyxDQUFDLENBQUM7Q0FDaEMsR0FBRztDQUNILEVBQUUsRUFBRSxJQUFJLENBQUMsSUFBSSxDQUFDO0NBQ2QsRUFBRSxPQUFPLElBQUksQ0FBQztDQUNkLENBQUM7QUFDRDtDQUNBO0NBQ0E7Q0FDQTtDQUNBO0NBQ0E7Q0FDQTtDQUNBO0NBQ0E7Q0FDQTtDQUNBLFNBQVMsWUFBWSxDQUFDLEdBQUcsRUFBRTtDQUMzQixFQUFFLElBQUksSUFBSSxHQUFHLElBQUksQ0FBQyxRQUFRO0NBQzFCLE1BQU0sS0FBSyxHQUFHLFlBQVksQ0FBQyxJQUFJLEVBQUUsR0FBRyxDQUFDLENBQUM7QUFDdEM7Q0FDQSxFQUFFLE9BQU8sS0FBSyxHQUFHLENBQUMsR0FBRyxTQUFTLEdBQUcsSUFBSSxDQUFDLEtBQUssQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDO0NBQ2hELENBQUM7QUFDRDtDQUNBO0NBQ0E7Q0FDQTtDQUNBO0NBQ0E7Q0FDQTtDQUNBO0NBQ0E7Q0FDQTtDQUNBLFNBQVMsWUFBWSxDQUFDLEdBQUcsRUFBRTtDQUMzQixFQUFFLE9BQU8sWUFBWSxDQUFDLElBQUksQ0FBQyxRQUFRLEVBQUUsR0FBRyxDQUFDLEdBQUcsQ0FBQyxDQUFDLENBQUM7Q0FDL0MsQ0FBQztBQUNEO0NBQ0E7Q0FDQTtDQUNBO0NBQ0E7Q0FDQTtDQUNBO0NBQ0E7Q0FDQTtDQUNBO0NBQ0E7Q0FDQSxTQUFTLFlBQVksQ0FBQyxHQUFHLEVBQUUsS0FBSyxFQUFFO0NBQ2xDLEVBQUUsSUFBSSxJQUFJLEdBQUcsSUFBSSxDQUFDLFFBQVE7Q0FDMUIsTUFBTSxLQUFLLEdBQUcsWUFBWSxDQUFDLElBQUksRUFBRSxHQUFHLENBQUMsQ0FBQztBQUN0QztDQUNBLEVBQUUsSUFBSSxLQUFLLEdBQUcsQ0FBQyxFQUFFO0NBQ2pCLElBQUksRUFBRSxJQUFJLENBQUMsSUFBSSxDQUFDO0NBQ2hCLElBQUksSUFBSSxDQUFDLElBQUksQ0FBQyxDQUFDLEdBQUcsRUFBRSxLQUFLLENBQUMsQ0FBQyxDQUFDO0NBQzVCLEdBQUcsTUFBTTtDQUNULElBQUksSUFBSSxDQUFDLEtBQUssQ0FBQyxDQUFDLENBQUMsQ0FBQyxHQUFHLEtBQUssQ0FBQztDQUMzQixHQUFHO0NBQ0gsRUFBRSxPQUFPLElBQUksQ0FBQztDQUNkLENBQUM7QUFDRDtDQUNBO0NBQ0EsU0FBUyxDQUFDLFNBQVMsQ0FBQyxLQUFLLEdBQUcsY0FBYyxDQUFDO0NBQzNDLFNBQVMsQ0FBQyxTQUFTLENBQUMsUUFBUSxDQUFDLEdBQUcsZUFBZSxDQUFDO0NBQ2hELFNBQVMsQ0FBQyxTQUFTLENBQUMsR0FBRyxHQUFHLFlBQVksQ0FBQztDQUN2QyxTQUFTLENBQUMsU0FBUyxDQUFDLEdBQUcsR0FBRyxZQUFZLENBQUM7Q0FDdkMsU0FBUyxDQUFDLFNBQVMsQ0FBQyxHQUFHLEdBQUcsWUFBWSxDQUFDO0FBQ3ZDO0NBQ0E7Q0FDQTtDQUNBO0NBQ0E7Q0FDQTtDQUNBO0NBQ0E7Q0FDQSxTQUFTLFFBQVEsQ0FBQyxPQUFPLEVBQUU7Q0FDM0IsRUFBRSxJQUFJLEtBQUssR0FBRyxDQUFDLENBQUM7Q0FDaEIsTUFBTSxNQUFNLEdBQUcsT0FBTyxJQUFJLElBQUksR0FBRyxDQUFDLEdBQUcsT0FBTyxDQUFDLE1BQU0sQ0FBQztBQUNwRDtDQUNBLEVBQUUsSUFBSSxDQUFDLEtBQUssRUFBRSxDQUFDO0NBQ2YsRUFBRSxPQUFPLEVBQUUsS0FBSyxHQUFHLE1BQU0sRUFBRTtDQUMzQixJQUFJLElBQUksS0FBSyxHQUFHLE9BQU8sQ0FBQyxLQUFLLENBQUMsQ0FBQztDQUMvQixJQUFJLElBQUksQ0FBQyxHQUFHLENBQUMsS0FBSyxDQUFDLENBQUMsQ0FBQyxFQUFFLEtBQUssQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDO0NBQ2pDLEdBQUc7Q0FDSCxDQUFDO0FBQ0Q7Q0FDQTtDQUNBO0NBQ0E7Q0FDQTtDQUNBO0NBQ0E7Q0FDQTtDQUNBLFNBQVMsYUFBYSxHQUFHO0NBQ3pCLEVBQUUsSUFBSSxDQUFDLElBQUksR0FBRyxDQUFDLENBQUM7Q0FDaEIsRUFBRSxJQUFJLENBQUMsUUFBUSxHQUFHO0NBQ2xCLElBQUksTUFBTSxFQUFFLElBQUksSUFBSTtDQUNwQixJQUFJLEtBQUssRUFBRSxLQUFLLEdBQUcsSUFBSSxTQUFTLENBQUM7Q0FDakMsSUFBSSxRQUFRLEVBQUUsSUFBSSxJQUFJO0NBQ3RCLEdBQUcsQ0FBQztDQUNKLENBQUM7QUFDRDtDQUNBO0NBQ0E7Q0FDQTtDQUNBO0NBQ0E7Q0FDQTtDQUNBO0NBQ0E7Q0FDQTtDQUNBLFNBQVMsY0FBYyxDQUFDLEdBQUcsRUFBRTtDQUM3QixFQUFFLElBQUksTUFBTSxHQUFHLFVBQVUsQ0FBQyxJQUFJLEVBQUUsR0FBRyxDQUFDLENBQUMsUUFBUSxDQUFDLENBQUMsR0FBRyxDQUFDLENBQUM7Q0FDcEQsRUFBRSxJQUFJLENBQUMsSUFBSSxJQUFJLE1BQU0sR0FBRyxDQUFDLEdBQUcsQ0FBQyxDQUFDO0NBQzlCLEVBQUUsT0FBTyxNQUFNLENBQUM7Q0FDaEIsQ0FBQztBQUNEO0NBQ0E7Q0FDQTtDQUNBO0NBQ0E7Q0FDQTtDQUNBO0NBQ0E7Q0FDQTtDQUNBO0NBQ0EsU0FBUyxXQUFXLENBQUMsR0FBRyxFQUFFO0NBQzFCLEVBQUUsT0FBTyxVQUFVLENBQUMsSUFBSSxFQUFFLEdBQUcsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxHQUFHLENBQUMsQ0FBQztDQUN4QyxDQUFDO0FBQ0Q7Q0FDQTtDQUNBO0NBQ0E7Q0FDQTtDQUNBO0NBQ0E7Q0FDQTtDQUNBO0NBQ0E7Q0FDQSxTQUFTLFdBQVcsQ0FBQyxHQUFHLEVBQUU7Q0FDMUIsRUFBRSxPQUFPLFVBQVUsQ0FBQyxJQUFJLEVBQUUsR0FBRyxDQUFDLENBQUMsR0FBRyxDQUFDLEdBQUcsQ0FBQyxDQUFDO0NBQ3hDLENBQUM7QUFDRDtDQUNBO0NBQ0E7Q0FDQTtDQUNBO0NBQ0E7Q0FDQTtDQUNBO0NBQ0E7Q0FDQTtDQUNBO0NBQ0EsU0FBUyxXQUFXLENBQUMsR0FBRyxFQUFFLEtBQUssRUFBRTtDQUNqQyxFQUFFLElBQUksSUFBSSxHQUFHLFVBQVUsQ0FBQyxJQUFJLEVBQUUsR0FBRyxDQUFDO0NBQ2xDLE1BQU0sSUFBSSxHQUFHLElBQUksQ0FBQyxJQUFJLENBQUM7QUFDdkI7Q0FDQSxFQUFFLElBQUksQ0FBQyxHQUFHLENBQUMsR0FBRyxFQUFFLEtBQUssQ0FBQyxDQUFDO0NBQ3ZCLEVBQUUsSUFBSSxDQUFDLElBQUksSUFBSSxJQUFJLENBQUMsSUFBSSxJQUFJLElBQUksR0FBRyxDQUFDLEdBQUcsQ0FBQyxDQUFDO0NBQ3pDLEVBQUUsT0FBTyxJQUFJLENBQUM7Q0FDZCxDQUFDO0FBQ0Q7Q0FDQTtDQUNBLFFBQVEsQ0FBQyxTQUFTLENBQUMsS0FBSyxHQUFHLGFBQWEsQ0FBQztDQUN6QyxRQUFRLENBQUMsU0FBUyxDQUFDLFFBQVEsQ0FBQyxHQUFHLGNBQWMsQ0FBQztDQUM5QyxRQUFRLENBQUMsU0FBUyxDQUFDLEdBQUcsR0FBRyxXQUFXLENBQUM7Q0FDckMsUUFBUSxDQUFDLFNBQVMsQ0FBQyxHQUFHLEdBQUcsV0FBVyxDQUFDO0NBQ3JDLFFBQVEsQ0FBQyxTQUFTLENBQUMsR0FBRyxHQUFHLFdBQVcsQ0FBQztBQUNyQztDQUNBO0NBQ0E7Q0FDQTtDQUNBO0NBQ0E7Q0FDQTtDQUNBO0NBQ0E7Q0FDQSxTQUFTLFFBQVEsQ0FBQyxNQUFNLEVBQUU7Q0FDMUIsRUFBRSxJQUFJLEtBQUssR0FBRyxDQUFDLENBQUM7Q0FDaEIsTUFBTSxNQUFNLEdBQUcsTUFBTSxJQUFJLElBQUksR0FBRyxDQUFDLEdBQUcsTUFBTSxDQUFDLE1BQU0sQ0FBQztBQUNsRDtDQUNBLEVBQUUsSUFBSSxDQUFDLFFBQVEsR0FBRyxJQUFJLFFBQVEsQ0FBQztDQUMvQixFQUFFLE9BQU8sRUFBRSxLQUFLLEdBQUcsTUFBTSxFQUFFO0NBQzNCLElBQUksSUFBSSxDQUFDLEdBQUcsQ0FBQyxNQUFNLENBQUMsS0FBSyxDQUFDLENBQUMsQ0FBQztDQUM1QixHQUFHO0NBQ0gsQ0FBQztBQUNEO0NBQ0E7Q0FDQTtDQUNBO0NBQ0E7Q0FDQTtDQUNBO0NBQ0E7Q0FDQTtDQUNBO0NBQ0E7Q0FDQSxTQUFTLFdBQVcsQ0FBQyxLQUFLLEVBQUU7Q0FDNUIsRUFBRSxJQUFJLENBQUMsUUFBUSxDQUFDLEdBQUcsQ0FBQyxLQUFLLEVBQUUsY0FBYyxDQUFDLENBQUM7Q0FDM0MsRUFBRSxPQUFPLElBQUksQ0FBQztDQUNkLENBQUM7QUFDRDtDQUNBO0NBQ0E7Q0FDQTtDQUNBO0NBQ0E7Q0FDQTtDQUNBO0NBQ0E7Q0FDQTtDQUNBLFNBQVMsV0FBVyxDQUFDLEtBQUssRUFBRTtDQUM1QixFQUFFLE9BQU8sSUFBSSxDQUFDLFFBQVEsQ0FBQyxHQUFHLENBQUMsS0FBSyxDQUFDLENBQUM7Q0FDbEMsQ0FBQztBQUNEO0NBQ0E7Q0FDQSxRQUFRLENBQUMsU0FBUyxDQUFDLEdBQUcsR0FBRyxRQUFRLENBQUMsU0FBUyxDQUFDLElBQUksR0FBRyxXQUFXLENBQUM7Q0FDL0QsUUFBUSxDQUFDLFNBQVMsQ0FBQyxHQUFHLEdBQUcsV0FBVyxDQUFDO0FBQ3JDO0NBQ0E7Q0FDQTtDQUNBO0NBQ0E7Q0FDQTtDQUNBO0NBQ0E7Q0FDQSxTQUFTLEtBQUssQ0FBQyxPQUFPLEVBQUU7Q0FDeEIsRUFBRSxJQUFJLElBQUksR0FBRyxJQUFJLENBQUMsUUFBUSxHQUFHLElBQUksU0FBUyxDQUFDLE9BQU8sQ0FBQyxDQUFDO0NBQ3BELEVBQUUsSUFBSSxDQUFDLElBQUksR0FBRyxJQUFJLENBQUMsSUFBSSxDQUFDO0NBQ3hCLENBQUM7QUFDRDtDQUNBO0NBQ0E7Q0FDQTtDQUNBO0NBQ0E7Q0FDQTtDQUNBO0NBQ0EsU0FBUyxVQUFVLEdBQUc7Q0FDdEIsRUFBRSxJQUFJLENBQUMsUUFBUSxHQUFHLElBQUksU0FBUyxDQUFDO0NBQ2hDLEVBQUUsSUFBSSxDQUFDLElBQUksR0FBRyxDQUFDLENBQUM7Q0FDaEIsQ0FBQztBQUNEO0NBQ0E7Q0FDQTtDQUNBO0NBQ0E7Q0FDQTtDQUNBO0NBQ0E7Q0FDQTtDQUNBO0NBQ0EsU0FBUyxXQUFXLENBQUMsR0FBRyxFQUFFO0NBQzFCLEVBQUUsSUFBSSxJQUFJLEdBQUcsSUFBSSxDQUFDLFFBQVE7Q0FDMUIsTUFBTSxNQUFNLEdBQUcsSUFBSSxDQUFDLFFBQVEsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxDQUFDO0FBQ25DO0NBQ0EsRUFBRSxJQUFJLENBQUMsSUFBSSxHQUFHLElBQUksQ0FBQyxJQUFJLENBQUM7Q0FDeEIsRUFBRSxPQUFPLE1BQU0sQ0FBQztDQUNoQixDQUFDO0FBQ0Q7Q0FDQTtDQUNBO0NBQ0E7Q0FDQTtDQUNBO0NBQ0E7Q0FDQTtDQUNBO0NBQ0E7Q0FDQSxTQUFTLFFBQVEsQ0FBQyxHQUFHLEVBQUU7Q0FDdkIsRUFBRSxPQUFPLElBQUksQ0FBQyxRQUFRLENBQUMsR0FBRyxDQUFDLEdBQUcsQ0FBQyxDQUFDO0NBQ2hDLENBQUM7QUFDRDtDQUNBO0NBQ0E7Q0FDQTtDQUNBO0NBQ0E7Q0FDQTtDQUNBO0NBQ0E7Q0FDQTtDQUNBLFNBQVMsUUFBUSxDQUFDLEdBQUcsRUFBRTtDQUN2QixFQUFFLE9BQU8sSUFBSSxDQUFDLFFBQVEsQ0FBQyxHQUFHLENBQUMsR0FBRyxDQUFDLENBQUM7Q0FDaEMsQ0FBQztBQUNEO0NBQ0E7Q0FDQTtDQUNBO0NBQ0E7Q0FDQTtDQUNBO0NBQ0E7Q0FDQTtDQUNBO0NBQ0E7Q0FDQSxTQUFTLFFBQVEsQ0FBQyxHQUFHLEVBQUUsS0FBSyxFQUFFO0NBQzlCLEVBQUUsSUFBSSxJQUFJLEdBQUcsSUFBSSxDQUFDLFFBQVEsQ0FBQztDQUMzQixFQUFFLElBQUksSUFBSSxZQUFZLFNBQVMsRUFBRTtDQUNqQyxJQUFJLElBQUksS0FBSyxHQUFHLElBQUksQ0FBQyxRQUFRLENBQUM7Q0FDOUIsSUFBSSxJQUFJLENBQUMsR0FBRyxLQUFLLEtBQUssQ0FBQyxNQUFNLEdBQUcsZ0JBQWdCLEdBQUcsQ0FBQyxDQUFDLEVBQUU7Q0FDdkQsTUFBTSxLQUFLLENBQUMsSUFBSSxDQUFDLENBQUMsR0FBRyxFQUFFLEtBQUssQ0FBQyxDQUFDLENBQUM7Q0FDL0IsTUFBTSxJQUFJLENBQUMsSUFBSSxHQUFHLEVBQUUsSUFBSSxDQUFDLElBQUksQ0FBQztDQUM5QixNQUFNLE9BQU8sSUFBSSxDQUFDO0NBQ2xCLEtBQUs7Q0FDTCxJQUFJLElBQUksR0FBRyxJQUFJLENBQUMsUUFBUSxHQUFHLElBQUksUUFBUSxDQUFDLEtBQUssQ0FBQyxDQUFDO0NBQy9DLEdBQUc7Q0FDSCxFQUFFLElBQUksQ0FBQyxHQUFHLENBQUMsR0FBRyxFQUFFLEtBQUssQ0FBQyxDQUFDO0NBQ3ZCLEVBQUUsSUFBSSxDQUFDLElBQUksR0FBRyxJQUFJLENBQUMsSUFBSSxDQUFDO0NBQ3hCLEVBQUUsT0FBTyxJQUFJLENBQUM7Q0FDZCxDQUFDO0FBQ0Q7Q0FDQTtDQUNBLEtBQUssQ0FBQyxTQUFTLENBQUMsS0FBSyxHQUFHLFVBQVUsQ0FBQztDQUNuQyxLQUFLLENBQUMsU0FBUyxDQUFDLFFBQVEsQ0FBQyxHQUFHLFdBQVcsQ0FBQztDQUN4QyxLQUFLLENBQUMsU0FBUyxDQUFDLEdBQUcsR0FBRyxRQUFRLENBQUM7Q0FDL0IsS0FBSyxDQUFDLFNBQVMsQ0FBQyxHQUFHLEdBQUcsUUFBUSxDQUFDO0NBQy9CLEtBQUssQ0FBQyxTQUFTLENBQUMsR0FBRyxHQUFHLFFBQVEsQ0FBQztBQUMvQjtDQUNBO0NBQ0E7Q0FDQTtDQUNBO0NBQ0E7Q0FDQTtDQUNBO0NBQ0E7Q0FDQSxTQUFTLGFBQWEsQ0FBQyxLQUFLLEVBQUUsU0FBUyxFQUFFO0NBQ3pDLEVBQUUsSUFBSSxLQUFLLEdBQUcsT0FBTyxDQUFDLEtBQUssQ0FBQztDQUM1QixNQUFNLEtBQUssR0FBRyxDQUFDLEtBQUssSUFBSSxXQUFXLENBQUMsS0FBSyxDQUFDO0NBQzFDLE1BQU0sTUFBTSxHQUFHLENBQUMsS0FBSyxJQUFJLENBQUMsS0FBSyxJQUFJLFFBQVEsQ0FBQyxLQUFLLENBQUM7Q0FDbEQsTUFBTSxNQUFNLEdBQUcsQ0FBQyxLQUFLLElBQUksQ0FBQyxLQUFLLElBQUksQ0FBQyxNQUFNLElBQUksWUFBWSxDQUFDLEtBQUssQ0FBQztDQUNqRSxNQUFNLFdBQVcsR0FBRyxLQUFLLElBQUksS0FBSyxJQUFJLE1BQU0sSUFBSSxNQUFNO0NBQ3RELE1BQU0sTUFBTSxHQUFHLFdBQVcsR0FBRyxTQUFTLENBQUMsS0FBSyxDQUFDLE1BQU0sRUFBRSxNQUFNLENBQUMsR0FBRyxFQUFFO0NBQ2pFLE1BQU0sTUFBTSxHQUFHLE1BQU0sQ0FBQyxNQUFNLENBQUM7QUFDN0I7Q0FDQSxFQUFFLEtBQUssSUFBSSxHQUFHLElBQUksS0FBSyxFQUFFO0NBQ3pCLElBQUksSUFBSSxDQUFDLFNBQVMsSUFBSSxjQUFjLENBQUMsSUFBSSxDQUFDLEtBQUssRUFBRSxHQUFHLENBQUM7Q0FDckQsUUFBUSxFQUFFLFdBQVc7Q0FDckI7Q0FDQSxXQUFXLEdBQUcsSUFBSSxRQUFRO0NBQzFCO0NBQ0EsWUFBWSxNQUFNLEtBQUssR0FBRyxJQUFJLFFBQVEsSUFBSSxHQUFHLElBQUksUUFBUSxDQUFDLENBQUM7Q0FDM0Q7Q0FDQSxZQUFZLE1BQU0sS0FBSyxHQUFHLElBQUksUUFBUSxJQUFJLEdBQUcsSUFBSSxZQUFZLElBQUksR0FBRyxJQUFJLFlBQVksQ0FBQyxDQUFDO0NBQ3RGO0NBQ0EsV0FBVyxPQUFPLENBQUMsR0FBRyxFQUFFLE1BQU0sQ0FBQztDQUMvQixTQUFTLENBQUMsRUFBRTtDQUNaLE1BQU0sTUFBTSxDQUFDLElBQUksQ0FBQyxHQUFHLENBQUMsQ0FBQztDQUN2QixLQUFLO0NBQ0wsR0FBRztDQUNILEVBQUUsT0FBTyxNQUFNLENBQUM7Q0FDaEIsQ0FBQztBQUNEO0NBQ0E7Q0FDQTtDQUNBO0NBQ0E7Q0FDQTtDQUNBO0NBQ0E7Q0FDQTtDQUNBLFNBQVMsWUFBWSxDQUFDLEtBQUssRUFBRSxHQUFHLEVBQUU7Q0FDbEMsRUFBRSxJQUFJLE1BQU0sR0FBRyxLQUFLLENBQUMsTUFBTSxDQUFDO0NBQzVCLEVBQUUsT0FBTyxNQUFNLEVBQUUsRUFBRTtDQUNuQixJQUFJLElBQUksRUFBRSxDQUFDLEtBQUssQ0FBQyxNQUFNLENBQUMsQ0FBQyxDQUFDLENBQUMsRUFBRSxHQUFHLENBQUMsRUFBRTtDQUNuQyxNQUFNLE9BQU8sTUFBTSxDQUFDO0NBQ3BCLEtBQUs7Q0FDTCxHQUFHO0NBQ0gsRUFBRSxPQUFPLENBQUMsQ0FBQyxDQUFDO0NBQ1osQ0FBQztBQUNEO0NBQ0E7Q0FDQTtDQUNBO0NBQ0E7Q0FDQTtDQUNBO0NBQ0E7Q0FDQTtDQUNBO0NBQ0E7Q0FDQTtDQUNBLFNBQVMsY0FBYyxDQUFDLE1BQU0sRUFBRSxRQUFRLEVBQUUsV0FBVyxFQUFFO0NBQ3ZELEVBQUUsSUFBSSxNQUFNLEdBQUcsUUFBUSxDQUFDLE1BQU0sQ0FBQyxDQUFDO0NBQ2hDLEVBQUUsT0FBTyxPQUFPLENBQUMsTUFBTSxDQUFDLEdBQUcsTUFBTSxHQUFHLFNBQVMsQ0FBQyxNQUFNLEVBQUUsV0FBVyxDQUFDLE1BQU0sQ0FBQyxDQUFDLENBQUM7Q0FDM0UsQ0FBQztBQUNEO0NBQ0E7Q0FDQTtDQUNBO0NBQ0E7Q0FDQTtDQUNBO0NBQ0E7Q0FDQSxTQUFTLFVBQVUsQ0FBQyxLQUFLLEVBQUU7Q0FDM0IsRUFBRSxJQUFJLEtBQUssSUFBSSxJQUFJLEVBQUU7Q0FDckIsSUFBSSxPQUFPLEtBQUssS0FBSyxTQUFTLEdBQUcsWUFBWSxHQUFHLE9BQU8sQ0FBQztDQUN4RCxHQUFHO0NBQ0gsRUFBRSxPQUFPLENBQUMsY0FBYyxJQUFJLGNBQWMsSUFBSSxNQUFNLENBQUMsS0FBSyxDQUFDO0NBQzNELE1BQU0sU0FBUyxDQUFDLEtBQUssQ0FBQztDQUN0QixNQUFNLGNBQWMsQ0FBQyxLQUFLLENBQUMsQ0FBQztDQUM1QixDQUFDO0FBQ0Q7Q0FDQTtDQUNBO0NBQ0E7Q0FDQTtDQUNBO0NBQ0E7Q0FDQTtDQUNBLFNBQVMsZUFBZSxDQUFDLEtBQUssRUFBRTtDQUNoQyxFQUFFLE9BQU8sWUFBWSxDQUFDLEtBQUssQ0FBQyxJQUFJLFVBQVUsQ0FBQyxLQUFLLENBQUMsSUFBSSxPQUFPLENBQUM7Q0FDN0QsQ0FBQztBQUNEO0NBQ0E7Q0FDQTtDQUNBO0NBQ0E7Q0FDQTtDQUNBO0NBQ0E7Q0FDQTtDQUNBO0NBQ0E7Q0FDQTtDQUNBO0NBQ0E7Q0FDQTtDQUNBLFNBQVMsV0FBVyxDQUFDLEtBQUssRUFBRSxLQUFLLEVBQUUsT0FBTyxFQUFFLFVBQVUsRUFBRSxLQUFLLEVBQUU7Q0FDL0QsRUFBRSxJQUFJLEtBQUssS0FBSyxLQUFLLEVBQUU7Q0FDdkIsSUFBSSxPQUFPLElBQUksQ0FBQztDQUNoQixHQUFHO0NBQ0gsRUFBRSxJQUFJLEtBQUssSUFBSSxJQUFJLElBQUksS0FBSyxJQUFJLElBQUksS0FBSyxDQUFDLFlBQVksQ0FBQyxLQUFLLENBQUMsSUFBSSxDQUFDLFlBQVksQ0FBQyxLQUFLLENBQUMsQ0FBQyxFQUFFO0NBQ3hGLElBQUksT0FBTyxLQUFLLEtBQUssS0FBSyxJQUFJLEtBQUssS0FBSyxLQUFLLENBQUM7Q0FDOUMsR0FBRztDQUNILEVBQUUsT0FBTyxlQUFlLENBQUMsS0FBSyxFQUFFLEtBQUssRUFBRSxPQUFPLEVBQUUsVUFBVSxFQUFFLFdBQVcsRUFBRSxLQUFLLENBQUMsQ0FBQztDQUNoRixDQUFDO0FBQ0Q7Q0FDQTtDQUNBO0NBQ0E7Q0FDQTtDQUNBO0NBQ0E7Q0FDQTtDQUNBO0NBQ0E7Q0FDQTtDQUNBO0NBQ0E7Q0FDQTtDQUNBO0NBQ0EsU0FBUyxlQUFlLENBQUMsTUFBTSxFQUFFLEtBQUssRUFBRSxPQUFPLEVBQUUsVUFBVSxFQUFFLFNBQVMsRUFBRSxLQUFLLEVBQUU7Q0FDL0UsRUFBRSxJQUFJLFFBQVEsR0FBRyxPQUFPLENBQUMsTUFBTSxDQUFDO0NBQ2hDLE1BQU0sUUFBUSxHQUFHLE9BQU8sQ0FBQyxLQUFLLENBQUM7Q0FDL0IsTUFBTSxNQUFNLEdBQUcsUUFBUSxHQUFHLFFBQVEsR0FBRyxNQUFNLENBQUMsTUFBTSxDQUFDO0NBQ25ELE1BQU0sTUFBTSxHQUFHLFFBQVEsR0FBRyxRQUFRLEdBQUcsTUFBTSxDQUFDLEtBQUssQ0FBQyxDQUFDO0FBQ25EO0NBQ0EsRUFBRSxNQUFNLEdBQUcsTUFBTSxJQUFJLE9BQU8sR0FBRyxTQUFTLEdBQUcsTUFBTSxDQUFDO0NBQ2xELEVBQUUsTUFBTSxHQUFHLE1BQU0sSUFBSSxPQUFPLEdBQUcsU0FBUyxHQUFHLE1BQU0sQ0FBQztBQUNsRDtDQUNBLEVBQUUsSUFBSSxRQUFRLEdBQUcsTUFBTSxJQUFJLFNBQVM7Q0FDcEMsTUFBTSxRQUFRLEdBQUcsTUFBTSxJQUFJLFNBQVM7Q0FDcEMsTUFBTSxTQUFTLEdBQUcsTUFBTSxJQUFJLE1BQU0sQ0FBQztBQUNuQztDQUNBLEVBQUUsSUFBSSxTQUFTLElBQUksUUFBUSxDQUFDLE1BQU0sQ0FBQyxFQUFFO0NBQ3JDLElBQUksSUFBSSxDQUFDLFFBQVEsQ0FBQyxLQUFLLENBQUMsRUFBRTtDQUMxQixNQUFNLE9BQU8sS0FBSyxDQUFDO0NBQ25CLEtBQUs7Q0FDTCxJQUFJLFFBQVEsR0FBRyxJQUFJLENBQUM7Q0FDcEIsSUFBSSxRQUFRLEdBQUcsS0FBSyxDQUFDO0NBQ3JCLEdBQUc7Q0FDSCxFQUFFLElBQUksU0FBUyxJQUFJLENBQUMsUUFBUSxFQUFFO0NBQzlCLElBQUksS0FBSyxLQUFLLEtBQUssR0FBRyxJQUFJLEtBQUssQ0FBQyxDQUFDO0NBQ2pDLElBQUksT0FBTyxDQUFDLFFBQVEsSUFBSSxZQUFZLENBQUMsTUFBTSxDQUFDO0NBQzVDLFFBQVEsV0FBVyxDQUFDLE1BQU0sRUFBRSxLQUFLLEVBQUUsT0FBTyxFQUFFLFVBQVUsRUFBRSxTQUFTLEVBQUUsS0FBSyxDQUFDO0NBQ3pFLFFBQVEsVUFBVSxDQUFDLE1BQU0sRUFBRSxLQUFLLEVBQUUsTUFBTSxFQUFFLE9BQU8sRUFBRSxVQUFVLEVBQUUsU0FBUyxFQUFFLEtBQUssQ0FBQyxDQUFDO0NBQ2pGLEdBQUc7Q0FDSCxFQUFFLElBQUksRUFBRSxPQUFPLEdBQUcsb0JBQW9CLENBQUMsRUFBRTtDQUN6QyxJQUFJLElBQUksWUFBWSxHQUFHLFFBQVEsSUFBSSxjQUFjLENBQUMsSUFBSSxDQUFDLE1BQU0sRUFBRSxhQUFhLENBQUM7Q0FDN0UsUUFBUSxZQUFZLEdBQUcsUUFBUSxJQUFJLGNBQWMsQ0FBQyxJQUFJLENBQUMsS0FBSyxFQUFFLGFBQWEsQ0FBQyxDQUFDO0FBQzdFO0NBQ0EsSUFBSSxJQUFJLFlBQVksSUFBSSxZQUFZLEVBQUU7Q0FDdEMsTUFBTSxJQUFJLFlBQVksR0FBRyxZQUFZLEdBQUcsTUFBTSxDQUFDLEtBQUssRUFBRSxHQUFHLE1BQU07Q0FDL0QsVUFBVSxZQUFZLEdBQUcsWUFBWSxHQUFHLEtBQUssQ0FBQyxLQUFLLEVBQUUsR0FBRyxLQUFLLENBQUM7QUFDOUQ7Q0FDQSxNQUFNLEtBQUssS0FBSyxLQUFLLEdBQUcsSUFBSSxLQUFLLENBQUMsQ0FBQztDQUNuQyxNQUFNLE9BQU8sU0FBUyxDQUFDLFlBQVksRUFBRSxZQUFZLEVBQUUsT0FBTyxFQUFFLFVBQVUsRUFBRSxLQUFLLENBQUMsQ0FBQztDQUMvRSxLQUFLO0NBQ0wsR0FBRztDQUNILEVBQUUsSUFBSSxDQUFDLFNBQVMsRUFBRTtDQUNsQixJQUFJLE9BQU8sS0FBSyxDQUFDO0NBQ2pCLEdBQUc7Q0FDSCxFQUFFLEtBQUssS0FBSyxLQUFLLEdBQUcsSUFBSSxLQUFLLENBQUMsQ0FBQztDQUMvQixFQUFFLE9BQU8sWUFBWSxDQUFDLE1BQU0sRUFBRSxLQUFLLEVBQUUsT0FBTyxFQUFFLFVBQVUsRUFBRSxTQUFTLEVBQUUsS0FBSyxDQUFDLENBQUM7Q0FDNUUsQ0FBQztBQUNEO0NBQ0E7Q0FDQTtDQUNBO0NBQ0E7Q0FDQTtDQUNBO0NBQ0E7Q0FDQTtDQUNBLFNBQVMsWUFBWSxDQUFDLEtBQUssRUFBRTtDQUM3QixFQUFFLElBQUksQ0FBQyxRQUFRLENBQUMsS0FBSyxDQUFDLElBQUksUUFBUSxDQUFDLEtBQUssQ0FBQyxFQUFFO0NBQzNDLElBQUksT0FBTyxLQUFLLENBQUM7Q0FDakIsR0FBRztDQUNILEVBQUUsSUFBSSxPQUFPLEdBQUcsVUFBVSxDQUFDLEtBQUssQ0FBQyxHQUFHLFVBQVUsR0FBRyxZQUFZLENBQUM7Q0FDOUQsRUFBRSxPQUFPLE9BQU8sQ0FBQyxJQUFJLENBQUMsUUFBUSxDQUFDLEtBQUssQ0FBQyxDQUFDLENBQUM7Q0FDdkMsQ0FBQztBQUNEO0NBQ0E7Q0FDQTtDQUNBO0NBQ0E7Q0FDQTtDQUNBO0NBQ0E7Q0FDQSxTQUFTLGdCQUFnQixDQUFDLEtBQUssRUFBRTtDQUNqQyxFQUFFLE9BQU8sWUFBWSxDQUFDLEtBQUssQ0FBQztDQUM1QixJQUFJLFFBQVEsQ0FBQyxLQUFLLENBQUMsTUFBTSxDQUFDLElBQUksQ0FBQyxDQUFDLGNBQWMsQ0FBQyxVQUFVLENBQUMsS0FBSyxDQUFDLENBQUMsQ0FBQztDQUNsRSxDQUFDO0FBQ0Q7Q0FDQTtDQUNBO0NBQ0E7Q0FDQTtDQUNBO0NBQ0E7Q0FDQTtDQUNBLFNBQVMsUUFBUSxDQUFDLE1BQU0sRUFBRTtDQUMxQixFQUFFLElBQUksQ0FBQyxXQUFXLENBQUMsTUFBTSxDQUFDLEVBQUU7Q0FDNUIsSUFBSSxPQUFPLFVBQVUsQ0FBQyxNQUFNLENBQUMsQ0FBQztDQUM5QixHQUFHO0NBQ0gsRUFBRSxJQUFJLE1BQU0sR0FBRyxFQUFFLENBQUM7Q0FDbEIsRUFBRSxLQUFLLElBQUksR0FBRyxJQUFJLE1BQU0sQ0FBQyxNQUFNLENBQUMsRUFBRTtDQUNsQyxJQUFJLElBQUksY0FBYyxDQUFDLElBQUksQ0FBQyxNQUFNLEVBQUUsR0FBRyxDQUFDLElBQUksR0FBRyxJQUFJLGFBQWEsRUFBRTtDQUNsRSxNQUFNLE1BQU0sQ0FBQyxJQUFJLENBQUMsR0FBRyxDQUFDLENBQUM7Q0FDdkIsS0FBSztDQUNMLEdBQUc7Q0FDSCxFQUFFLE9BQU8sTUFBTSxDQUFDO0NBQ2hCLENBQUM7QUFDRDtDQUNBO0NBQ0E7Q0FDQTtDQUNBO0NBQ0E7Q0FDQTtDQUNBO0NBQ0E7Q0FDQTtDQUNBO0NBQ0E7Q0FDQTtDQUNBO0NBQ0EsU0FBUyxXQUFXLENBQUMsS0FBSyxFQUFFLEtBQUssRUFBRSxPQUFPLEVBQUUsVUFBVSxFQUFFLFNBQVMsRUFBRSxLQUFLLEVBQUU7Q0FDMUUsRUFBRSxJQUFJLFNBQVMsR0FBRyxPQUFPLEdBQUcsb0JBQW9CO0NBQ2hELE1BQU0sU0FBUyxHQUFHLEtBQUssQ0FBQyxNQUFNO0NBQzlCLE1BQU0sU0FBUyxHQUFHLEtBQUssQ0FBQyxNQUFNLENBQUM7QUFDL0I7Q0FDQSxFQUFFLElBQUksU0FBUyxJQUFJLFNBQVMsSUFBSSxFQUFFLFNBQVMsSUFBSSxTQUFTLEdBQUcsU0FBUyxDQUFDLEVBQUU7Q0FDdkUsSUFBSSxPQUFPLEtBQUssQ0FBQztDQUNqQixHQUFHO0NBQ0g7Q0FDQSxFQUFFLElBQUksT0FBTyxHQUFHLEtBQUssQ0FBQyxHQUFHLENBQUMsS0FBSyxDQUFDLENBQUM7Q0FDakMsRUFBRSxJQUFJLE9BQU8sSUFBSSxLQUFLLENBQUMsR0FBRyxDQUFDLEtBQUssQ0FBQyxFQUFFO0NBQ25DLElBQUksT0FBTyxPQUFPLElBQUksS0FBSyxDQUFDO0NBQzVCLEdBQUc7Q0FDSCxFQUFFLElBQUksS0FBSyxHQUFHLENBQUMsQ0FBQztDQUNoQixNQUFNLE1BQU0sR0FBRyxJQUFJO0NBQ25CLE1BQU0sSUFBSSxHQUFHLENBQUMsT0FBTyxHQUFHLHNCQUFzQixJQUFJLElBQUksUUFBUSxHQUFHLFNBQVMsQ0FBQztBQUMzRTtDQUNBLEVBQUUsS0FBSyxDQUFDLEdBQUcsQ0FBQyxLQUFLLEVBQUUsS0FBSyxDQUFDLENBQUM7Q0FDMUIsRUFBRSxLQUFLLENBQUMsR0FBRyxDQUFDLEtBQUssRUFBRSxLQUFLLENBQUMsQ0FBQztBQUMxQjtDQUNBO0NBQ0EsRUFBRSxPQUFPLEVBQUUsS0FBSyxHQUFHLFNBQVMsRUFBRTtDQUM5QixJQUFJLElBQUksUUFBUSxHQUFHLEtBQUssQ0FBQyxLQUFLLENBQUM7Q0FDL0IsUUFBUSxRQUFRLEdBQUcsS0FBSyxDQUFDLEtBQUssQ0FBQyxDQUFDO0FBQ2hDO0NBQ0EsSUFBSSxJQUFJLFVBQVUsRUFBRTtDQUNwQixNQUFNLElBQUksUUFBUSxHQUFHLFNBQVM7Q0FDOUIsVUFBVSxVQUFVLENBQUMsUUFBUSxFQUFFLFFBQVEsRUFBRSxLQUFLLEVBQUUsS0FBSyxFQUFFLEtBQUssRUFBRSxLQUFLLENBQUM7Q0FDcEUsVUFBVSxVQUFVLENBQUMsUUFBUSxFQUFFLFFBQVEsRUFBRSxLQUFLLEVBQUUsS0FBSyxFQUFFLEtBQUssRUFBRSxLQUFLLENBQUMsQ0FBQztDQUNyRSxLQUFLO0NBQ0wsSUFBSSxJQUFJLFFBQVEsS0FBSyxTQUFTLEVBQUU7Q0FDaEMsTUFBTSxJQUFJLFFBQVEsRUFBRTtDQUNwQixRQUFRLFNBQVM7Q0FDakIsT0FBTztDQUNQLE1BQU0sTUFBTSxHQUFHLEtBQUssQ0FBQztDQUNyQixNQUFNLE1BQU07Q0FDWixLQUFLO0NBQ0w7Q0FDQSxJQUFJLElBQUksSUFBSSxFQUFFO0NBQ2QsTUFBTSxJQUFJLENBQUMsU0FBUyxDQUFDLEtBQUssRUFBRSxTQUFTLFFBQVEsRUFBRSxRQUFRLEVBQUU7Q0FDekQsWUFBWSxJQUFJLENBQUMsUUFBUSxDQUFDLElBQUksRUFBRSxRQUFRLENBQUM7Q0FDekMsaUJBQWlCLFFBQVEsS0FBSyxRQUFRLElBQUksU0FBUyxDQUFDLFFBQVEsRUFBRSxRQUFRLEVBQUUsT0FBTyxFQUFFLFVBQVUsRUFBRSxLQUFLLENBQUMsQ0FBQyxFQUFFO0NBQ3RHLGNBQWMsT0FBTyxJQUFJLENBQUMsSUFBSSxDQUFDLFFBQVEsQ0FBQyxDQUFDO0NBQ3pDLGFBQWE7Q0FDYixXQUFXLENBQUMsRUFBRTtDQUNkLFFBQVEsTUFBTSxHQUFHLEtBQUssQ0FBQztDQUN2QixRQUFRLE1BQU07Q0FDZCxPQUFPO0NBQ1AsS0FBSyxNQUFNLElBQUk7Q0FDZixVQUFVLFFBQVEsS0FBSyxRQUFRO0NBQy9CLFlBQVksU0FBUyxDQUFDLFFBQVEsRUFBRSxRQUFRLEVBQUUsT0FBTyxFQUFFLFVBQVUsRUFBRSxLQUFLLENBQUM7Q0FDckUsU0FBUyxFQUFFO0NBQ1gsTUFBTSxNQUFNLEdBQUcsS0FBSyxDQUFDO0NBQ3JCLE1BQU0sTUFBTTtDQUNaLEtBQUs7Q0FDTCxHQUFHO0NBQ0gsRUFBRSxLQUFLLENBQUMsUUFBUSxDQUFDLENBQUMsS0FBSyxDQUFDLENBQUM7Q0FDekIsRUFBRSxLQUFLLENBQUMsUUFBUSxDQUFDLENBQUMsS0FBSyxDQUFDLENBQUM7Q0FDekIsRUFBRSxPQUFPLE1BQU0sQ0FBQztDQUNoQixDQUFDO0FBQ0Q7Q0FDQTtDQUNBO0NBQ0E7Q0FDQTtDQUNBO0NBQ0E7Q0FDQTtDQUNBO0NBQ0E7Q0FDQTtDQUNBO0NBQ0E7Q0FDQTtDQUNBO0NBQ0E7Q0FDQTtDQUNBO0NBQ0EsU0FBUyxVQUFVLENBQUMsTUFBTSxFQUFFLEtBQUssRUFBRSxHQUFHLEVBQUUsT0FBTyxFQUFFLFVBQVUsRUFBRSxTQUFTLEVBQUUsS0FBSyxFQUFFO0NBQy9FLEVBQUUsUUFBUSxHQUFHO0NBQ2IsSUFBSSxLQUFLLFdBQVc7Q0FDcEIsTUFBTSxJQUFJLENBQUMsTUFBTSxDQUFDLFVBQVUsSUFBSSxLQUFLLENBQUMsVUFBVTtDQUNoRCxXQUFXLE1BQU0sQ0FBQyxVQUFVLElBQUksS0FBSyxDQUFDLFVBQVUsQ0FBQyxFQUFFO0NBQ25ELFFBQVEsT0FBTyxLQUFLLENBQUM7Q0FDckIsT0FBTztDQUNQLE1BQU0sTUFBTSxHQUFHLE1BQU0sQ0FBQyxNQUFNLENBQUM7Q0FDN0IsTUFBTSxLQUFLLEdBQUcsS0FBSyxDQUFDLE1BQU0sQ0FBQztBQUMzQjtDQUNBLElBQUksS0FBSyxjQUFjO0NBQ3ZCLE1BQU0sSUFBSSxDQUFDLE1BQU0sQ0FBQyxVQUFVLElBQUksS0FBSyxDQUFDLFVBQVU7Q0FDaEQsVUFBVSxDQUFDLFNBQVMsQ0FBQyxJQUFJLFVBQVUsQ0FBQyxNQUFNLENBQUMsRUFBRSxJQUFJLFVBQVUsQ0FBQyxLQUFLLENBQUMsQ0FBQyxFQUFFO0NBQ3JFLFFBQVEsT0FBTyxLQUFLLENBQUM7Q0FDckIsT0FBTztDQUNQLE1BQU0sT0FBTyxJQUFJLENBQUM7QUFDbEI7Q0FDQSxJQUFJLEtBQUssT0FBTyxDQUFDO0NBQ2pCLElBQUksS0FBSyxPQUFPLENBQUM7Q0FDakIsSUFBSSxLQUFLLFNBQVM7Q0FDbEI7Q0FDQTtDQUNBLE1BQU0sT0FBTyxFQUFFLENBQUMsQ0FBQyxNQUFNLEVBQUUsQ0FBQyxLQUFLLENBQUMsQ0FBQztBQUNqQztDQUNBLElBQUksS0FBSyxRQUFRO0NBQ2pCLE1BQU0sT0FBTyxNQUFNLENBQUMsSUFBSSxJQUFJLEtBQUssQ0FBQyxJQUFJLElBQUksTUFBTSxDQUFDLE9BQU8sSUFBSSxLQUFLLENBQUMsT0FBTyxDQUFDO0FBQzFFO0NBQ0EsSUFBSSxLQUFLLFNBQVMsQ0FBQztDQUNuQixJQUFJLEtBQUssU0FBUztDQUNsQjtDQUNBO0NBQ0E7Q0FDQSxNQUFNLE9BQU8sTUFBTSxLQUFLLEtBQUssR0FBRyxFQUFFLENBQUMsQ0FBQztBQUNwQztDQUNBLElBQUksS0FBSyxNQUFNO0NBQ2YsTUFBTSxJQUFJLE9BQU8sR0FBRyxVQUFVLENBQUM7QUFDL0I7Q0FDQSxJQUFJLEtBQUssTUFBTTtDQUNmLE1BQU0sSUFBSSxTQUFTLEdBQUcsT0FBTyxHQUFHLG9CQUFvQixDQUFDO0NBQ3JELE1BQU0sT0FBTyxLQUFLLE9BQU8sR0FBRyxVQUFVLENBQUMsQ0FBQztBQUN4QztDQUNBLE1BQU0sSUFBSSxNQUFNLENBQUMsSUFBSSxJQUFJLEtBQUssQ0FBQyxJQUFJLElBQUksQ0FBQyxTQUFTLEVBQUU7Q0FDbkQsUUFBUSxPQUFPLEtBQUssQ0FBQztDQUNyQixPQUFPO0NBQ1A7Q0FDQSxNQUFNLElBQUksT0FBTyxHQUFHLEtBQUssQ0FBQyxHQUFHLENBQUMsTUFBTSxDQUFDLENBQUM7Q0FDdEMsTUFBTSxJQUFJLE9BQU8sRUFBRTtDQUNuQixRQUFRLE9BQU8sT0FBTyxJQUFJLEtBQUssQ0FBQztDQUNoQyxPQUFPO0NBQ1AsTUFBTSxPQUFPLElBQUksc0JBQXNCLENBQUM7QUFDeEM7Q0FDQTtDQUNBLE1BQU0sS0FBSyxDQUFDLEdBQUcsQ0FBQyxNQUFNLEVBQUUsS0FBSyxDQUFDLENBQUM7Q0FDL0IsTUFBTSxJQUFJLE1BQU0sR0FBRyxXQUFXLENBQUMsT0FBTyxDQUFDLE1BQU0sQ0FBQyxFQUFFLE9BQU8sQ0FBQyxLQUFLLENBQUMsRUFBRSxPQUFPLEVBQUUsVUFBVSxFQUFFLFNBQVMsRUFBRSxLQUFLLENBQUMsQ0FBQztDQUN2RyxNQUFNLEtBQUssQ0FBQyxRQUFRLENBQUMsQ0FBQyxNQUFNLENBQUMsQ0FBQztDQUM5QixNQUFNLE9BQU8sTUFBTSxDQUFDO0FBQ3BCO0NBQ0EsSUFBSSxLQUFLLFNBQVM7Q0FDbEIsTUFBTSxJQUFJLGFBQWEsRUFBRTtDQUN6QixRQUFRLE9BQU8sYUFBYSxDQUFDLElBQUksQ0FBQyxNQUFNLENBQUMsSUFBSSxhQUFhLENBQUMsSUFBSSxDQUFDLEtBQUssQ0FBQyxDQUFDO0NBQ3ZFLE9BQU87Q0FDUCxHQUFHO0NBQ0gsRUFBRSxPQUFPLEtBQUssQ0FBQztDQUNmLENBQUM7QUFDRDtDQUNBO0NBQ0E7Q0FDQTtDQUNBO0NBQ0E7Q0FDQTtDQUNBO0NBQ0E7Q0FDQTtDQUNBO0NBQ0E7Q0FDQTtDQUNBO0NBQ0EsU0FBUyxZQUFZLENBQUMsTUFBTSxFQUFFLEtBQUssRUFBRSxPQUFPLEVBQUUsVUFBVSxFQUFFLFNBQVMsRUFBRSxLQUFLLEVBQUU7Q0FDNUUsRUFBRSxJQUFJLFNBQVMsR0FBRyxPQUFPLEdBQUcsb0JBQW9CO0NBQ2hELE1BQU0sUUFBUSxHQUFHLFVBQVUsQ0FBQyxNQUFNLENBQUM7Q0FDbkMsTUFBTSxTQUFTLEdBQUcsUUFBUSxDQUFDLE1BQU07Q0FDakMsTUFBTSxRQUFRLEdBQUcsVUFBVSxDQUFDLEtBQUssQ0FBQztDQUNsQyxNQUFNLFNBQVMsR0FBRyxRQUFRLENBQUMsTUFBTSxDQUFDO0FBQ2xDO0NBQ0EsRUFBRSxJQUFJLFNBQVMsSUFBSSxTQUFTLElBQUksQ0FBQyxTQUFTLEVBQUU7Q0FDNUMsSUFBSSxPQUFPLEtBQUssQ0FBQztDQUNqQixHQUFHO0NBQ0gsRUFBRSxJQUFJLEtBQUssR0FBRyxTQUFTLENBQUM7Q0FDeEIsRUFBRSxPQUFPLEtBQUssRUFBRSxFQUFFO0NBQ2xCLElBQUksSUFBSSxHQUFHLEdBQUcsUUFBUSxDQUFDLEtBQUssQ0FBQyxDQUFDO0NBQzlCLElBQUksSUFBSSxFQUFFLFNBQVMsR0FBRyxHQUFHLElBQUksS0FBSyxHQUFHLGNBQWMsQ0FBQyxJQUFJLENBQUMsS0FBSyxFQUFFLEdBQUcsQ0FBQyxDQUFDLEVBQUU7Q0FDdkUsTUFBTSxPQUFPLEtBQUssQ0FBQztDQUNuQixLQUFLO0NBQ0wsR0FBRztDQUNIO0NBQ0EsRUFBRSxJQUFJLE9BQU8sR0FBRyxLQUFLLENBQUMsR0FBRyxDQUFDLE1BQU0sQ0FBQyxDQUFDO0NBQ2xDLEVBQUUsSUFBSSxPQUFPLElBQUksS0FBSyxDQUFDLEdBQUcsQ0FBQyxLQUFLLENBQUMsRUFBRTtDQUNuQyxJQUFJLE9BQU8sT0FBTyxJQUFJLEtBQUssQ0FBQztDQUM1QixHQUFHO0NBQ0gsRUFBRSxJQUFJLE1BQU0sR0FBRyxJQUFJLENBQUM7Q0FDcEIsRUFBRSxLQUFLLENBQUMsR0FBRyxDQUFDLE1BQU0sRUFBRSxLQUFLLENBQUMsQ0FBQztDQUMzQixFQUFFLEtBQUssQ0FBQyxHQUFHLENBQUMsS0FBSyxFQUFFLE1BQU0sQ0FBQyxDQUFDO0FBQzNCO0NBQ0EsRUFBRSxJQUFJLFFBQVEsR0FBRyxTQUFTLENBQUM7Q0FDM0IsRUFBRSxPQUFPLEVBQUUsS0FBSyxHQUFHLFNBQVMsRUFBRTtDQUM5QixJQUFJLEdBQUcsR0FBRyxRQUFRLENBQUMsS0FBSyxDQUFDLENBQUM7Q0FDMUIsSUFBSSxJQUFJLFFBQVEsR0FBRyxNQUFNLENBQUMsR0FBRyxDQUFDO0NBQzlCLFFBQVEsUUFBUSxHQUFHLEtBQUssQ0FBQyxHQUFHLENBQUMsQ0FBQztBQUM5QjtDQUNBLElBQUksSUFBSSxVQUFVLEVBQUU7Q0FDcEIsTUFBTSxJQUFJLFFBQVEsR0FBRyxTQUFTO0NBQzlCLFVBQVUsVUFBVSxDQUFDLFFBQVEsRUFBRSxRQUFRLEVBQUUsR0FBRyxFQUFFLEtBQUssRUFBRSxNQUFNLEVBQUUsS0FBSyxDQUFDO0NBQ25FLFVBQVUsVUFBVSxDQUFDLFFBQVEsRUFBRSxRQUFRLEVBQUUsR0FBRyxFQUFFLE1BQU0sRUFBRSxLQUFLLEVBQUUsS0FBSyxDQUFDLENBQUM7Q0FDcEUsS0FBSztDQUNMO0NBQ0EsSUFBSSxJQUFJLEVBQUUsUUFBUSxLQUFLLFNBQVM7Q0FDaEMsYUFBYSxRQUFRLEtBQUssUUFBUSxJQUFJLFNBQVMsQ0FBQyxRQUFRLEVBQUUsUUFBUSxFQUFFLE9BQU8sRUFBRSxVQUFVLEVBQUUsS0FBSyxDQUFDO0NBQy9GLFlBQVksUUFBUTtDQUNwQixTQUFTLEVBQUU7Q0FDWCxNQUFNLE1BQU0sR0FBRyxLQUFLLENBQUM7Q0FDckIsTUFBTSxNQUFNO0NBQ1osS0FBSztDQUNMLElBQUksUUFBUSxLQUFLLFFBQVEsR0FBRyxHQUFHLElBQUksYUFBYSxDQUFDLENBQUM7Q0FDbEQsR0FBRztDQUNILEVBQUUsSUFBSSxNQUFNLElBQUksQ0FBQyxRQUFRLEVBQUU7Q0FDM0IsSUFBSSxJQUFJLE9BQU8sR0FBRyxNQUFNLENBQUMsV0FBVztDQUNwQyxRQUFRLE9BQU8sR0FBRyxLQUFLLENBQUMsV0FBVyxDQUFDO0FBQ3BDO0NBQ0E7Q0FDQSxJQUFJLElBQUksT0FBTyxJQUFJLE9BQU87Q0FDMUIsU0FBUyxhQUFhLElBQUksTUFBTSxJQUFJLGFBQWEsSUFBSSxLQUFLLENBQUM7Q0FDM0QsUUFBUSxFQUFFLE9BQU8sT0FBTyxJQUFJLFVBQVUsSUFBSSxPQUFPLFlBQVksT0FBTztDQUNwRSxVQUFVLE9BQU8sT0FBTyxJQUFJLFVBQVUsSUFBSSxPQUFPLFlBQVksT0FBTyxDQUFDLEVBQUU7Q0FDdkUsTUFBTSxNQUFNLEdBQUcsS0FBSyxDQUFDO0NBQ3JCLEtBQUs7Q0FDTCxHQUFHO0NBQ0gsRUFBRSxLQUFLLENBQUMsUUFBUSxDQUFDLENBQUMsTUFBTSxDQUFDLENBQUM7Q0FDMUIsRUFBRSxLQUFLLENBQUMsUUFBUSxDQUFDLENBQUMsS0FBSyxDQUFDLENBQUM7Q0FDekIsRUFBRSxPQUFPLE1BQU0sQ0FBQztDQUNoQixDQUFDO0FBQ0Q7Q0FDQTtDQUNBO0NBQ0E7Q0FDQTtDQUNBO0NBQ0E7Q0FDQTtDQUNBLFNBQVMsVUFBVSxDQUFDLE1BQU0sRUFBRTtDQUM1QixFQUFFLE9BQU8sY0FBYyxDQUFDLE1BQU0sRUFBRSxJQUFJLEVBQUUsVUFBVSxDQUFDLENBQUM7Q0FDbEQsQ0FBQztBQUNEO0NBQ0E7Q0FDQTtDQUNBO0NBQ0E7Q0FDQTtDQUNBO0NBQ0E7Q0FDQTtDQUNBLFNBQVMsVUFBVSxDQUFDLEdBQUcsRUFBRSxHQUFHLEVBQUU7Q0FDOUIsRUFBRSxJQUFJLElBQUksR0FBRyxHQUFHLENBQUMsUUFBUSxDQUFDO0NBQzFCLEVBQUUsT0FBTyxTQUFTLENBQUMsR0FBRyxDQUFDO0NBQ3ZCLE1BQU0sSUFBSSxDQUFDLE9BQU8sR0FBRyxJQUFJLFFBQVEsR0FBRyxRQUFRLEdBQUcsTUFBTSxDQUFDO0NBQ3RELE1BQU0sSUFBSSxDQUFDLEdBQUcsQ0FBQztDQUNmLENBQUM7QUFDRDtDQUNBO0NBQ0E7Q0FDQTtDQUNBO0NBQ0E7Q0FDQTtDQUNBO0NBQ0E7Q0FDQSxTQUFTLFNBQVMsQ0FBQyxNQUFNLEVBQUUsR0FBRyxFQUFFO0NBQ2hDLEVBQUUsSUFBSSxLQUFLLEdBQUcsUUFBUSxDQUFDLE1BQU0sRUFBRSxHQUFHLENBQUMsQ0FBQztDQUNwQyxFQUFFLE9BQU8sWUFBWSxDQUFDLEtBQUssQ0FBQyxHQUFHLEtBQUssR0FBRyxTQUFTLENBQUM7Q0FDakQsQ0FBQztBQUNEO0NBQ0E7Q0FDQTtDQUNBO0NBQ0E7Q0FDQTtDQUNBO0NBQ0E7Q0FDQSxTQUFTLFNBQVMsQ0FBQyxLQUFLLEVBQUU7Q0FDMUIsRUFBRSxJQUFJLEtBQUssR0FBRyxjQUFjLENBQUMsSUFBSSxDQUFDLEtBQUssRUFBRSxjQUFjLENBQUM7Q0FDeEQsTUFBTSxHQUFHLEdBQUcsS0FBSyxDQUFDLGNBQWMsQ0FBQyxDQUFDO0FBQ2xDO0NBQ0EsRUFBRSxJQUFJO0NBQ04sSUFBSSxLQUFLLENBQUMsY0FBYyxDQUFDLEdBQUcsU0FBUyxDQUFDO0NBQ3RDLElBQUksSUFBSSxRQUFRLEdBQUcsSUFBSSxDQUFDO0NBQ3hCLEdBQUcsQ0FBQyxPQUFPLENBQUMsRUFBRSxFQUFFO0FBQ2hCO0NBQ0EsRUFBRSxJQUFJLE1BQU0sR0FBRyxvQkFBb0IsQ0FBQyxJQUFJLENBQUMsS0FBSyxDQUFDLENBQUM7Q0FDaEQsRUFBRSxJQUFJLFFBQVEsRUFBRTtDQUNoQixJQUFJLElBQUksS0FBSyxFQUFFO0NBQ2YsTUFBTSxLQUFLLENBQUMsY0FBYyxDQUFDLEdBQUcsR0FBRyxDQUFDO0NBQ2xDLEtBQUssTUFBTTtDQUNYLE1BQU0sT0FBTyxLQUFLLENBQUMsY0FBYyxDQUFDLENBQUM7Q0FDbkMsS0FBSztDQUNMLEdBQUc7Q0FDSCxFQUFFLE9BQU8sTUFBTSxDQUFDO0NBQ2hCLENBQUM7QUFDRDtDQUNBO0NBQ0E7Q0FDQTtDQUNBO0NBQ0E7Q0FDQTtDQUNBO0NBQ0EsSUFBSSxVQUFVLEdBQUcsQ0FBQyxnQkFBZ0IsR0FBRyxTQUFTLEdBQUcsU0FBUyxNQUFNLEVBQUU7Q0FDbEUsRUFBRSxJQUFJLE1BQU0sSUFBSSxJQUFJLEVBQUU7Q0FDdEIsSUFBSSxPQUFPLEVBQUUsQ0FBQztDQUNkLEdBQUc7Q0FDSCxFQUFFLE1BQU0sR0FBRyxNQUFNLENBQUMsTUFBTSxDQUFDLENBQUM7Q0FDMUIsRUFBRSxPQUFPLFdBQVcsQ0FBQyxnQkFBZ0IsQ0FBQyxNQUFNLENBQUMsRUFBRSxTQUFTLE1BQU0sRUFBRTtDQUNoRSxJQUFJLE9BQU8sb0JBQW9CLENBQUMsSUFBSSxDQUFDLE1BQU0sRUFBRSxNQUFNLENBQUMsQ0FBQztDQUNyRCxHQUFHLENBQUMsQ0FBQztDQUNMLENBQUMsQ0FBQztBQUNGO0NBQ0E7Q0FDQTtDQUNBO0NBQ0E7Q0FDQTtDQUNBO0NBQ0E7Q0FDQSxJQUFJLE1BQU0sR0FBRyxVQUFVLENBQUM7QUFDeEI7Q0FDQTtDQUNBLElBQUksQ0FBQyxRQUFRLElBQUksTUFBTSxDQUFDLElBQUksUUFBUSxDQUFDLElBQUksV0FBVyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsSUFBSSxXQUFXO0NBQ3hFLEtBQUssR0FBRyxJQUFJLE1BQU0sQ0FBQyxJQUFJLEdBQUcsQ0FBQyxJQUFJLE1BQU0sQ0FBQztDQUN0QyxLQUFLLE9BQU8sSUFBSSxNQUFNLENBQUMsT0FBTyxDQUFDLE9BQU8sRUFBRSxDQUFDLElBQUksVUFBVSxDQUFDO0NBQ3hELEtBQUssR0FBRyxJQUFJLE1BQU0sQ0FBQyxJQUFJLEdBQUcsQ0FBQyxJQUFJLE1BQU0sQ0FBQztDQUN0QyxLQUFLLE9BQU8sSUFBSSxNQUFNLENBQUMsSUFBSSxPQUFPLENBQUMsSUFBSSxVQUFVLENBQUMsRUFBRTtDQUNwRCxFQUFFLE1BQU0sR0FBRyxTQUFTLEtBQUssRUFBRTtDQUMzQixJQUFJLElBQUksTUFBTSxHQUFHLFVBQVUsQ0FBQyxLQUFLLENBQUM7Q0FDbEMsUUFBUSxJQUFJLEdBQUcsTUFBTSxJQUFJLFNBQVMsR0FBRyxLQUFLLENBQUMsV0FBVyxHQUFHLFNBQVM7Q0FDbEUsUUFBUSxVQUFVLEdBQUcsSUFBSSxHQUFHLFFBQVEsQ0FBQyxJQUFJLENBQUMsR0FBRyxFQUFFLENBQUM7QUFDaEQ7Q0FDQSxJQUFJLElBQUksVUFBVSxFQUFFO0NBQ3BCLE1BQU0sUUFBUSxVQUFVO0NBQ3hCLFFBQVEsS0FBSyxrQkFBa0IsRUFBRSxPQUFPLFdBQVcsQ0FBQztDQUNwRCxRQUFRLEtBQUssYUFBYSxFQUFFLE9BQU8sTUFBTSxDQUFDO0NBQzFDLFFBQVEsS0FBSyxpQkFBaUIsRUFBRSxPQUFPLFVBQVUsQ0FBQztDQUNsRCxRQUFRLEtBQUssYUFBYSxFQUFFLE9BQU8sTUFBTSxDQUFDO0NBQzFDLFFBQVEsS0FBSyxpQkFBaUIsRUFBRSxPQUFPLFVBQVUsQ0FBQztDQUNsRCxPQUFPO0NBQ1AsS0FBSztDQUNMLElBQUksT0FBTyxNQUFNLENBQUM7Q0FDbEIsR0FBRyxDQUFDO0NBQ0osQ0FBQztBQUNEO0NBQ0E7Q0FDQTtDQUNBO0NBQ0E7Q0FDQTtDQUNBO0NBQ0E7Q0FDQTtDQUNBLFNBQVMsT0FBTyxDQUFDLEtBQUssRUFBRSxNQUFNLEVBQUU7Q0FDaEMsRUFBRSxNQUFNLEdBQUcsTUFBTSxJQUFJLElBQUksR0FBRyxnQkFBZ0IsR0FBRyxNQUFNLENBQUM7Q0FDdEQsRUFBRSxPQUFPLENBQUMsQ0FBQyxNQUFNO0NBQ2pCLEtBQUssT0FBTyxLQUFLLElBQUksUUFBUSxJQUFJLFFBQVEsQ0FBQyxJQUFJLENBQUMsS0FBSyxDQUFDLENBQUM7Q0FDdEQsS0FBSyxLQUFLLEdBQUcsQ0FBQyxDQUFDLElBQUksS0FBSyxHQUFHLENBQUMsSUFBSSxDQUFDLElBQUksS0FBSyxHQUFHLE1BQU0sQ0FBQyxDQUFDO0NBQ3JELENBQUM7QUFDRDtDQUNBO0NBQ0E7Q0FDQTtDQUNBO0NBQ0E7Q0FDQTtDQUNBO0NBQ0EsU0FBUyxTQUFTLENBQUMsS0FBSyxFQUFFO0NBQzFCLEVBQUUsSUFBSSxJQUFJLEdBQUcsT0FBTyxLQUFLLENBQUM7Q0FDMUIsRUFBRSxPQUFPLENBQUMsSUFBSSxJQUFJLFFBQVEsSUFBSSxJQUFJLElBQUksUUFBUSxJQUFJLElBQUksSUFBSSxRQUFRLElBQUksSUFBSSxJQUFJLFNBQVM7Q0FDdkYsT0FBTyxLQUFLLEtBQUssV0FBVztDQUM1QixPQUFPLEtBQUssS0FBSyxJQUFJLENBQUMsQ0FBQztDQUN2QixDQUFDO0FBQ0Q7Q0FDQTtDQUNBO0NBQ0E7Q0FDQTtDQUNBO0NBQ0E7Q0FDQTtDQUNBLFNBQVMsUUFBUSxDQUFDLElBQUksRUFBRTtDQUN4QixFQUFFLE9BQU8sQ0FBQyxDQUFDLFVBQVUsS0FBSyxVQUFVLElBQUksSUFBSSxDQUFDLENBQUM7Q0FDOUMsQ0FBQztBQUNEO0NBQ0E7Q0FDQTtDQUNBO0NBQ0E7Q0FDQTtDQUNBO0NBQ0E7Q0FDQSxTQUFTLFdBQVcsQ0FBQyxLQUFLLEVBQUU7Q0FDNUIsRUFBRSxJQUFJLElBQUksR0FBRyxLQUFLLElBQUksS0FBSyxDQUFDLFdBQVc7Q0FDdkMsTUFBTSxLQUFLLEdBQUcsQ0FBQyxPQUFPLElBQUksSUFBSSxVQUFVLElBQUksSUFBSSxDQUFDLFNBQVMsS0FBSyxXQUFXLENBQUM7QUFDM0U7Q0FDQSxFQUFFLE9BQU8sS0FBSyxLQUFLLEtBQUssQ0FBQztDQUN6QixDQUFDO0FBQ0Q7Q0FDQTtDQUNBO0NBQ0E7Q0FDQTtDQUNBO0NBQ0E7Q0FDQTtDQUNBLFNBQVMsY0FBYyxDQUFDLEtBQUssRUFBRTtDQUMvQixFQUFFLE9BQU8sb0JBQW9CLENBQUMsSUFBSSxDQUFDLEtBQUssQ0FBQyxDQUFDO0NBQzFDLENBQUM7QUFDRDtDQUNBO0NBQ0E7Q0FDQTtDQUNBO0NBQ0E7Q0FDQTtDQUNBO0NBQ0EsU0FBUyxRQUFRLENBQUMsSUFBSSxFQUFFO0NBQ3hCLEVBQUUsSUFBSSxJQUFJLElBQUksSUFBSSxFQUFFO0NBQ3BCLElBQUksSUFBSTtDQUNSLE1BQU0sT0FBTyxZQUFZLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxDQUFDO0NBQ3JDLEtBQUssQ0FBQyxPQUFPLENBQUMsRUFBRSxFQUFFO0NBQ2xCLElBQUksSUFBSTtDQUNSLE1BQU0sUUFBUSxJQUFJLEdBQUcsRUFBRSxFQUFFO0NBQ3pCLEtBQUssQ0FBQyxPQUFPLENBQUMsRUFBRSxFQUFFO0NBQ2xCLEdBQUc7Q0FDSCxFQUFFLE9BQU8sRUFBRSxDQUFDO0NBQ1osQ0FBQztBQUNEO0NBQ0E7Q0FDQTtDQUNBO0NBQ0E7Q0FDQTtDQUNBO0NBQ0E7Q0FDQTtDQUNBO0NBQ0E7Q0FDQTtDQUNBO0NBQ0E7Q0FDQTtDQUNBO0NBQ0E7Q0FDQTtDQUNBO0NBQ0E7Q0FDQTtDQUNBO0NBQ0E7Q0FDQTtDQUNBO0NBQ0E7Q0FDQTtDQUNBO0NBQ0E7Q0FDQTtDQUNBO0NBQ0E7Q0FDQTtDQUNBLFNBQVMsRUFBRSxDQUFDLEtBQUssRUFBRSxLQUFLLEVBQUU7Q0FDMUIsRUFBRSxPQUFPLEtBQUssS0FBSyxLQUFLLEtBQUssS0FBSyxLQUFLLEtBQUssSUFBSSxLQUFLLEtBQUssS0FBSyxDQUFDLENBQUM7Q0FDakUsQ0FBQztBQUNEO0NBQ0E7Q0FDQTtDQUNBO0NBQ0E7Q0FDQTtDQUNBO0NBQ0E7Q0FDQTtDQUNBO0NBQ0E7Q0FDQTtDQUNBO0NBQ0E7Q0FDQTtDQUNBO0NBQ0E7Q0FDQTtDQUNBO0NBQ0EsSUFBSSxXQUFXLEdBQUcsZUFBZSxDQUFDLFdBQVcsRUFBRSxPQUFPLFNBQVMsQ0FBQyxFQUFFLEVBQUUsQ0FBQyxHQUFHLGVBQWUsR0FBRyxTQUFTLEtBQUssRUFBRTtDQUMxRyxFQUFFLE9BQU8sWUFBWSxDQUFDLEtBQUssQ0FBQyxJQUFJLGNBQWMsQ0FBQyxJQUFJLENBQUMsS0FBSyxFQUFFLFFBQVEsQ0FBQztDQUNwRSxJQUFJLENBQUMsb0JBQW9CLENBQUMsSUFBSSxDQUFDLEtBQUssRUFBRSxRQUFRLENBQUMsQ0FBQztDQUNoRCxDQUFDLENBQUM7QUFDRjtDQUNBO0NBQ0E7Q0FDQTtDQUNBO0NBQ0E7Q0FDQTtDQUNBO0NBQ0E7Q0FDQTtDQUNBO0NBQ0E7Q0FDQTtDQUNBO0NBQ0E7Q0FDQTtDQUNBO0NBQ0E7Q0FDQTtDQUNBO0NBQ0E7Q0FDQTtDQUNBO0NBQ0E7Q0FDQSxJQUFJLE9BQU8sR0FBRyxLQUFLLENBQUMsT0FBTyxDQUFDO0FBQzVCO0NBQ0E7Q0FDQTtDQUNBO0NBQ0E7Q0FDQTtDQUNBO0NBQ0E7Q0FDQTtDQUNBO0NBQ0E7Q0FDQTtDQUNBO0NBQ0E7Q0FDQTtDQUNBO0NBQ0E7Q0FDQTtDQUNBO0NBQ0E7Q0FDQTtDQUNBO0NBQ0E7Q0FDQTtDQUNBO0NBQ0E7Q0FDQSxTQUFTLFdBQVcsQ0FBQyxLQUFLLEVBQUU7Q0FDNUIsRUFBRSxPQUFPLEtBQUssSUFBSSxJQUFJLElBQUksUUFBUSxDQUFDLEtBQUssQ0FBQyxNQUFNLENBQUMsSUFBSSxDQUFDLFVBQVUsQ0FBQyxLQUFLLENBQUMsQ0FBQztDQUN2RSxDQUFDO0FBQ0Q7Q0FDQTtDQUNBO0NBQ0E7Q0FDQTtDQUNBO0NBQ0E7Q0FDQTtDQUNBO0NBQ0E7Q0FDQTtDQUNBO0NBQ0E7Q0FDQTtDQUNBO0NBQ0E7Q0FDQTtDQUNBO0NBQ0EsSUFBSSxRQUFRLEdBQUcsY0FBYyxJQUFJLFNBQVMsQ0FBQztBQUMzQztDQUNBO0NBQ0E7Q0FDQTtDQUNBO0NBQ0E7Q0FDQTtDQUNBO0NBQ0E7Q0FDQTtDQUNBO0NBQ0E7Q0FDQTtDQUNBO0NBQ0E7Q0FDQTtDQUNBO0NBQ0E7Q0FDQTtDQUNBO0NBQ0E7Q0FDQTtDQUNBO0NBQ0E7Q0FDQTtDQUNBO0NBQ0E7Q0FDQTtDQUNBO0NBQ0EsU0FB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
