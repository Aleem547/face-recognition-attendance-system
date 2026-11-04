# Third-party components and licensing

This release does not choose a project-wide license on the author's behalf. Review licensing before offering reuse terms for the project as a whole.

| Component | Preserved source / notice |
| --- | --- |
| JSFeat browser detector | `application/public/attendai-face-overlay/LICENSE-jsfeat.txt` and `NOTICE.txt` |
| Face cascade / js-objectdetect | `application/public/attendai-face-overlay/LICENSE-objectdetect.txt` and `CLASSIFIER-LICENSES.txt` |
| YuNet and SFace | `application/face-engine/licenses/` and `models.lock.json` |
| Texture PAD models | `application/face-engine/pad/NOTICE.txt`, `pad/models.json`, and `pad/licenses/` |
| Web packages | Exact resolution and integrity values in `application/package-lock.json`; upstream packages retain their own license terms |
| Python packages | Hash-pinned requirements in `application/face-engine/requirements.lock`; upstream packages retain their own license terms |

The browser cascade is bundled with its notices. Native face/PAD model binaries are not included. The model manager uses the existing pinned manifests to obtain them separately. Names of components describe the implementation, not an independent endorsement of the prototype's reliability.
