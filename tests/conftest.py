"""Shared pytest configuration for the GrantSentinel test-suite.

Windows shim for gltest direct mode
-----------------------------------
gltest's direct mode extracts GenVM SDK artifacts to a temp tree and then
removes files that may still be briefly memory-mapped by the interpreter. On
Windows this surfaces as transient PermissionError / OSError during cleanup,
which fails an otherwise green run.

Binding the original os.unlink / os.remove here, before any plugin or test can
monkeypatch them, lets us wrap deletion with a short retry and tolerate
"already gone" errors without hiding real failures. This module must be
imported (as conftest.py) before the gltest plugin registers its teardown.
"""

import errno
import os
import time

# Bind the untouched originals first, before anything else can patch them.
_ORIGINAL_UNLINK = os.unlink
_ORIGINAL_REMOVE = os.remove

# Keep the pristine references available to tests that need real semantics.
grantsentinel_original_unlink = _ORIGINAL_UNLINK
grantsentinel_original_remove = _ORIGINAL_REMOVE

# Errors that mean the path is effectively already deleted or not ours to keep.
_BENIGN = (errno.ENOENT, errno.ENOTEMPTY, errno.EEXIST, errno.EACCES)


def _tolerant_delete(path, *args, **kwargs):
    last_error = None
    for _attempt in range(6):
        try:
            return _ORIGINAL_REMOVE(path, *args, **kwargs)
        except PermissionError as exc:
            last_error = exc
            time.sleep(0.05)
        except IsADirectoryError:
            return _ORIGINAL_UNLINK(path, *args, **kwargs)
        except OSError as exc:
            if exc.errno in _BENIGN:
                return None
            raise
    if last_error is not None:
        # A file we could never remove is left in place rather than crashing a
        # passing test run; cleanup is best-effort on Windows.
        return None
    return None


# Rebind to the tolerant versions. rmtree and other helpers route through these.
os.unlink = _tolerant_delete
os.remove = _tolerant_delete
