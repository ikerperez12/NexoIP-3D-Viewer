import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { AlertTriangle, RefreshCw, UploadCloud } from 'lucide-react';
import { disposeModelResources, load3DModel } from '../utils/loaders.js';
import { callNexoip, responseModelUrl } from '../utils/nexoip.js';
import { applyCameraAction } from '../utils/camera-controls.js';
import { createDemandRenderScheduler } from '../utils/render-loop.js';

function disposeLightGroup(group) {
  group?.traverse((object) => object.shadow?.dispose?.());
  group?.clear();
}

function revokeBlobUrl(url) {
  if (typeof url === 'string' && url.startsWith('blob:')) URL.revokeObjectURL(url);
}

function updateCameraEvidence(element, camera, controls) {
  if (!element || !camera || !controls) return '';
  const values = [
    ...camera.position.toArray(),
    ...controls.target.toArray(),
    camera.zoom,
  ];
  const snapshot = values
    .map((value) => (Number.isFinite(value) ? value.toFixed(8) : 'invalid'))
    .join(',');
  element.dataset.cameraState = snapshot;
  return snapshot;
}

function safeDownloadName(fileName) {
  return String(fileName || 'captura').replace(/[^a-z0-9._-]+/gi, '_');
}

export default function Viewport3D({
  currentFile,
  renderMode,
  envPreset,
  showGrid,
  showAxes,
  autoRotate,
  isOrthographic,
  cameraPresetRequest,
  resetCameraRequest,
  cameraControlRequest,
  snapshotRequest,
  selectedClipIndex,
  isPlaying,
  playbackSpeed,
  seekRequest,
  onModelLoaded,
  onAnimationProgress,
  onSnapshotResult,
  onModelError,
  onChooseAnotherModel,
  nodeVisibilityToggle
}) {
  const containerRef = useRef(null);
  const sceneRef = useRef(null);
  const rendererRef = useRef(null);
  const cameraRef = useRef(null);
  const perspectiveCameraRef = useRef(null);
  const orthographicCameraRef = useRef(null);
  const controlsRef = useRef(null);
  const currentModelRef = useRef(null);
  const mixerRef = useRef(null);
  const activeActionRef = useRef(null);
  const animationsRef = useRef([]);
  const lightsGroupRef = useRef(null);
  const gridHelperRef = useRef(null);
  const axesHelperRef = useRef(null);
  const originalMaterialsRef = useRef(new Map());
  const previewMaterialsRef = useRef(new Set());
  const lastProgressTimeRef = useRef(0);
  const loadAbortRef = useRef(null);
  const snapshotInProgressRef = useRef(false);
  const errorDialogRef = useRef(null);
  const invalidateRef = useRef(() => false);
  const controlsInteractionRef = useRef(false);

  const [loading, setLoading] = useState(false);
  const [loadProgress, setLoadProgress] = useState(null);
  const [error, setError] = useState(null);
  const [rendererError, setRendererError] = useState(null);
  const [retryNonce, setRetryNonce] = useState(0);
  const [contextLost, setContextLost] = useState(false);
  const [rendererGeneration, setRendererGeneration] = useState(0);

  const invalidateViewport = () => invalidateRef.current();
  const getContainerSize = () => {
    const bounds = containerRef.current?.getBoundingClientRect();
    return {
      width: Math.max(Math.floor(bounds?.width || 0), 1),
      height: Math.max(Math.floor(bounds?.height || 0), 1),
    };
  };

  const updateOrthographicFrustum = (camera, width, height) => {
    if (!camera) return;
    const viewSize = camera.userData.viewSize || 10;
    const aspect = Math.max(width / Math.max(height, 1), 0.01);
    camera.left = -(viewSize * aspect) / 2;
    camera.right = (viewSize * aspect) / 2;
    camera.top = viewSize / 2;
    camera.bottom = -viewSize / 2;
    camera.updateProjectionMatrix();
  };

  const setupLighting = (group, preset) => {
    disposeLightGroup(group);
    if (!sceneRef.current) return;

    sceneRef.current.background = new THREE.Color(preset === 'white' ? 0xf3f4f6 : 0x000000);
    group.add(new THREE.HemisphereLight(0xffffff, 0x080808, 0.55));

    const addSpotlight = ({ color, intensity, position, angle, penumbra, castShadow = false }) => {
      const light = new THREE.SpotLight(color, intensity, 0, angle, penumbra, 0);
      light.position.copy(position);
      light.target.position.set(0, 0, 0);
      light.castShadow = castShadow;
      if (castShadow) {
        light.shadow.mapSize.set(1024, 1024);
        light.shadow.bias = -0.0005;
      }
      group.add(light, light.target);
      return light;
    };

    const palette = {
      cyberpunk: [0xec4899, 0x06b6d4, 0xa855f7],
      sunset: [0xf97316, 0xfacc15, 0xffedd5],
      emerald: [0x10b981, 0x34d399, 0x06b6d4],
      fireice: [0xef4444, 0x38bdf8, 0xffffff],
      studio_pro: [0xffffff, 0xe0e7ff, 0xffffff],
      white: [0xffffff, 0xe5e7eb, 0xffffff]
    }[preset] || [0xffffff, 0xe0e7ff, 0xffffff];

    addSpotlight({
      color: palette[0], intensity: 4.8, position: new THREE.Vector3(8, 16, 10),
      angle: Math.PI / 3.5, penumbra: 0.45, castShadow: true
    });
    addSpotlight({
      color: palette[1], intensity: 3.1, position: new THREE.Vector3(-9, 14, -8),
      angle: Math.PI / 3, penumbra: 0.55
    });
    addSpotlight({
      color: palette[2], intensity: 2.4, position: new THREE.Vector3(0, 20, 2),
      angle: Math.PI / 4, penumbra: 0.35
    });
    invalidateViewport();
  };

  const disposePreviewMaterials = () => {
    previewMaterialsRef.current.forEach((material) => material.dispose());
    previewMaterialsRef.current.clear();
  };

  const restoreOriginalMaterials = () => {
    const model = currentModelRef.current;
    if (!model) return;
    model.traverse((child) => {
      if (!child.isMesh) return;
      const original = originalMaterialsRef.current.get(child.uuid);
      if (original) child.material = original;
    });
    disposePreviewMaterials();
  };

  const releaseCurrentModel = () => {
    const model = currentModelRef.current;
    if (!model) return;

    const mixer = mixerRef.current;
    if (mixer) {
      mixer.stopAllAction();
      mixer.uncacheRoot(model);
    }
    restoreOriginalMaterials();
    sceneRef.current?.remove(model);
    disposeModelResources(model);
    currentModelRef.current = null;
    mixerRef.current = null;
    activeActionRef.current = null;
    animationsRef.current = [];
    originalMaterialsRef.current.clear();
    invalidateViewport();
  };

  const centerAndFitCamera = (object) => {
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    if (!object || !camera || !controls) return;

    const boundingBox = new THREE.Box3().setFromObject(object);
    if (boundingBox.isEmpty()) return;
    const center = boundingBox.getCenter(new THREE.Vector3());
    const size = boundingBox.getSize(new THREE.Vector3());
    const maxDimension = Math.max(size.x, size.y, size.z, 0.01);

    object.position.sub(center);
    object.position.y -= boundingBox.min.y - center.y;
    controls.target.set(0, size.y / 2, 0);

    let cameraDistance;
    if (camera.isOrthographicCamera) {
      camera.userData.viewSize = maxDimension * 1.8;
      updateOrthographicFrustum(camera, containerRef.current?.clientWidth || 1, containerRef.current?.clientHeight || 1);
      camera.position.set(maxDimension * 1.35, maxDimension, maxDimension * 1.35);
      cameraDistance = camera.position.distanceTo(controls.target);
    } else {
      const fov = THREE.MathUtils.degToRad(camera.fov);
      const distance = Math.max((maxDimension / 2) / Math.tan(fov / 2) * 1.8, 1);
      camera.position.set(0, Math.max(size.y * 0.8, maxDimension * 0.25), distance);
      cameraDistance = camera.position.distanceTo(controls.target);
    }
    camera.near = Math.max(maxDimension / 100_000, 0.001);
    camera.far = Math.max(maxDimension * 100, cameraDistance * 20, 100);
    camera.updateProjectionMatrix();
    camera.lookAt(controls.target);
    controls.update();
    gridHelperRef.current?.scale.setScalar(Math.max(1, maxDimension / 10));
    invalidateViewport();
  };

  const applyRenderMode = (mode) => {
    const model = currentModelRef.current;
    if (!model) return;

    restoreOriginalMaterials();
    if (mode === 'pbr') {
      invalidateViewport();
      return;
    }

    model.traverse((child) => {
      if (!child.isMesh) return;
      const original = originalMaterialsRef.current.get(child.uuid);
      const sourceMaterial = Array.isArray(original) ? original[0] : original;
      let previewMaterial;

      if (mode === 'wireframe') {
        previewMaterial = new THREE.MeshBasicMaterial({ color: 0x818cf8, wireframe: true });
      } else if (mode === 'normals') {
        previewMaterial = new THREE.MeshNormalMaterial();
      } else if (mode === 'xray') {
        previewMaterial = new THREE.MeshPhysicalMaterial({
          color: 0x6366f1, transparent: true, opacity: 0.35, roughness: 0.1, metalness: 0.1, transmission: 0.9
        });
      } else if (mode === 'unlit') {
        previewMaterial = new THREE.MeshBasicMaterial({
          map: sourceMaterial?.map || null,
          color: sourceMaterial?.color || 0xffffff
        });
      }

      if (previewMaterial) {
        child.material = previewMaterial;
        previewMaterialsRef.current.add(previewMaterial);
      }
    });
    invalidateViewport();
  };

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x000000);
    sceneRef.current = scene;

    // The rendered box stays accurate at browser zoom and prevents the WebGL
    // canvas from expanding beyond the accessible viewport.
    const { width, height } = getContainerSize();
    const perspectiveCamera = new THREE.PerspectiveCamera(45, width / height, 0.1, 1000);
    const orthographicCamera = new THREE.OrthographicCamera(-5, 5, 5, -5, 0.1, 1000);
    orthographicCamera.userData.viewSize = 10;
    updateOrthographicFrustum(orthographicCamera, width, height);
    perspectiveCamera.position.set(3, 2, 5);
    orthographicCamera.position.copy(perspectiveCamera.position);
    perspectiveCameraRef.current = perspectiveCamera;
    orthographicCameraRef.current = orthographicCamera;
    const initialCamera = isOrthographic ? orthographicCamera : perspectiveCamera;
    cameraRef.current = initialCamera;

    let renderer;
    let controls;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
      renderer.setSize(width, height, false);
      renderer.domElement.style.display = 'block';
      renderer.domElement.style.width = '100%';
      renderer.domElement.style.height = '100%';
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.2;
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      container.appendChild(renderer.domElement);
      rendererRef.current = renderer;

      controls = new OrbitControls(initialCamera, renderer.domElement);
      controls.enableDamping = true;
      controls.dampingFactor = 0.06;
      controls.maxPolarAngle = Math.PI;
      controls.autoRotate = autoRotate;
      controls.autoRotateSpeed = 1.6;
      controlsRef.current = controls;
      controls.listenToKeyEvents(container);
      updateCameraEvidence(container, initialCamera, controls);
    } catch (rendererError) {
      controls?.dispose();
      renderer?.dispose();
      renderer?.domElement?.remove();
      rendererRef.current = null;
      controlsRef.current = null;
      const detail = rendererError instanceof Error ? rendererError.message : 'Error WebGL desconocido.';
      const failureTimer = window.setTimeout(() => {
        setLoading(false);
        setContextLost(true);
        setRendererError(`No se pudo iniciar el renderizado 3D (${detail}). Actualiza el controlador gráfico o cierra otras aplicaciones 3D y pulsa Recuperar vista.`);
      }, 0);
      return () => {
        window.clearTimeout(failureTimer);
        scene.clear();
        sceneRef.current = null;
        cameraRef.current = null;
        perspectiveCameraRef.current = null;
        orthographicCameraRef.current = null;
      };
    }

    const lights = new THREE.Group();
    scene.add(lights);
    lightsGroupRef.current = lights;
    setupLighting(lights, envPreset);

    const grid = new THREE.GridHelper(20, 20, 0x6b7280, 0x1f2937);
    grid.visible = showGrid;
    scene.add(grid);
    gridHelperRef.current = grid;
    const axes = new THREE.AxesHelper(2);
    axes.visible = showAxes;
    scene.add(axes);
    axesHelperRef.current = axes;

    let scheduler;
    let readyTimer = null;
    const reportRendererFailure = (renderError) => {
      if (readyTimer !== null) window.clearTimeout(readyTimer);
      scheduler?.setSuspended(true);
      const detail = renderError instanceof Error ? renderError.message : 'Error WebGL desconocido.';
      setContextLost(true);
      setRendererError(`La vista 3D dejó de responder (${detail}). Cierra otras aplicaciones 3D y pulsa Recuperar vista.`);
    };
    scheduler = createDemandRenderScheduler({
      requestFrame: (callback) => window.requestAnimationFrame(callback),
      cancelFrame: (frameId) => window.cancelAnimationFrame(frameId),
      onFrame: ({ timestamp, deltaSeconds }) => {
        const actionBeforeUpdate = activeActionRef.current;
        if (actionBeforeUpdate?.isRunning?.()) mixerRef.current?.update(deltaSeconds);
        const controlsChanged = controls.update(deltaSeconds);
        renderer.render(scene, cameraRef.current);

        const action = activeActionRef.current;
        if (action?.getClip().duration && timestamp - lastProgressTimeRef.current > 80) {
          lastProgressTimeRef.current = timestamp;
          onAnimationProgress?.(THREE.MathUtils.clamp(action.time / action.getClip().duration, 0, 1));
        }
        return Boolean(
          controlsInteractionRef.current
          || controls.autoRotate
          || controlsChanged
          || action?.isRunning?.()
        );
      },
      onError: reportRendererFailure,
    });
    invalidateRef.current = scheduler.invalidate;

    const handleControlStart = () => {
      controlsInteractionRef.current = true;
      scheduler.invalidate();
    };
    const handleControlChange = () => scheduler.invalidate();
    const handleControlEnd = () => {
      controlsInteractionRef.current = false;
      scheduler.invalidate();
    };
    controls.addEventListener('start', handleControlStart);
    controls.addEventListener('change', handleControlChange);
    controls.addEventListener('end', handleControlEnd);
    const handleVisibilityChange = () => {
      scheduler.setSuspended(document.hidden);
    };
    const resize = () => {
      const { width: nextWidth, height: nextHeight } = getContainerSize();
      perspectiveCamera.aspect = nextWidth / nextHeight;
      perspectiveCamera.updateProjectionMatrix();
      updateOrthographicFrustum(orthographicCamera, nextWidth, nextHeight);
      renderer.setSize(nextWidth, nextHeight, false);
      scheduler.invalidate();
    };
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(container);
    const handleContextLost = (event) => {
      event.preventDefault();
      if (readyTimer !== null) window.clearTimeout(readyTimer);
      scheduler.setSuspended(true);
      setContextLost(true);
      setRendererError('La GPU perdió el contexto de renderizado. Cierra otras aplicaciones 3D y pulsa Recuperar vista para crear un lienzo nuevo.');
    };
    const handleContextRestored = () => {
      setRendererGeneration((value) => value + 1);
    };
    renderer.domElement.addEventListener('webglcontextlost', handleContextLost);
    renderer.domElement.addEventListener('webglcontextrestored', handleContextRestored);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    container.dataset.rendererGeneration = String(rendererGeneration);
    container.dataset.renderLoop = 'demand';
    scheduler.setSuspended(document.hidden);
    scheduler.invalidate();
    readyTimer = window.setTimeout(() => {
      setContextLost(false);
      setRendererError(null);
    }, 0);

    return () => {
      if (readyTimer !== null) window.clearTimeout(readyTimer);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      resizeObserver.disconnect();
      loadAbortRef.current?.abort();
      releaseCurrentModel();
      disposeLightGroup(lights);
      grid.geometry.dispose();
      (Array.isArray(grid.material) ? grid.material : [grid.material]).forEach((material) => material?.dispose());
      axes.geometry.dispose();
      (Array.isArray(axes.material) ? axes.material : [axes.material]).forEach((material) => material?.dispose());
      renderer.domElement.removeEventListener('webglcontextlost', handleContextLost);
      renderer.domElement.removeEventListener('webglcontextrestored', handleContextRestored);
      controls.removeEventListener('start', handleControlStart);
      controls.removeEventListener('change', handleControlChange);
      controls.removeEventListener('end', handleControlEnd);
      controls.stopListenToKeyEvents();
      controls.dispose();
      scheduler.dispose();
      controlsInteractionRef.current = false;
      if (invalidateRef.current === scheduler.invalidate) invalidateRef.current = () => false;
      renderer.dispose();
      renderer.domElement.remove();
      scene.clear();
      rendererRef.current = null;
      controlsRef.current = null;
      sceneRef.current = null;
      cameraRef.current = null;
      perspectiveCameraRef.current = null;
      orthographicCameraRef.current = null;
      lightsGroupRef.current = null;
      gridHelperRef.current = null;
      axesHelperRef.current = null;
      delete container.dataset.rendererGeneration;
      delete container.dataset.renderLoop;
    };
  // A generation is a real WebGL lifecycle; recovery replaces renderer, controls, canvas, and scene.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rendererGeneration]);

  useEffect(() => {
    if (lightsGroupRef.current) setupLighting(lightsGroupRef.current, envPreset);
  // Lighting mutates the stable Three.js scene held by refs.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [envPreset]);

  useEffect(() => {
    const controls = controlsRef.current;
    const nextCamera = isOrthographic ? orthographicCameraRef.current : perspectiveCameraRef.current;
    if (!controls || !nextCamera || cameraRef.current === nextCamera) return;

    if (nextCamera.isOrthographicCamera && currentModelRef.current) {
      const size = new THREE.Box3().setFromObject(currentModelRef.current).getSize(new THREE.Vector3());
      nextCamera.userData.viewSize = Math.max(size.x, size.y, size.z, 0.01) * 1.8;
      updateOrthographicFrustum(nextCamera, containerRef.current?.clientWidth || 1, containerRef.current?.clientHeight || 1);
    }
    nextCamera.position.copy(cameraRef.current.position);
    nextCamera.quaternion.copy(cameraRef.current.quaternion);
    controls.object = nextCamera;
    cameraRef.current = nextCamera;
    nextCamera.lookAt(controls.target);
    controls.update();
    updateCameraEvidence(containerRef.current, nextCamera, controls);
    invalidateViewport();
  }, [isOrthographic]);

  useEffect(() => {
    if (!sceneRef.current || !rendererRef.current) return undefined;
    loadAbortRef.current?.abort();
    if (!currentFile?.id) {
      releaseCurrentModel();
      const clearStateTimer = window.setTimeout(() => {
        setLoading(false);
        setLoadProgress(null);
        setError(null);
      }, 0);
      return () => window.clearTimeout(clearStateTimer);
    }
    let cancelled = false;
    let modelUrl = null;
    const abortController = new AbortController();
    loadAbortRef.current = abortController;

    const loadModel = async () => {
      releaseCurrentModel();
      setLoading(true);
      setLoadProgress(0);
      setError(null);
      try {
        modelUrl = responseModelUrl(await callNexoip('getModelUrl', currentFile.id));
        if (!modelUrl) throw new Error('No se pudo resolver la ubicación segura del modelo.');
        const { object, exportObject, animations, stats, metadata } = await load3DModel(modelUrl, currentFile.name, (value) => {
          if (!cancelled) setLoadProgress(value);
        }, { renderer: rendererRef.current, signal: abortController.signal });
        if (cancelled) {
          disposeModelResources(object);
          return;
        }

        originalMaterialsRef.current.clear();
        object.traverse((child) => {
          if (child.isMesh && child.material) originalMaterialsRef.current.set(child.uuid, child.material);
        });
        sceneRef.current.add(object);
        currentModelRef.current = object;
        animationsRef.current = animations || [];
        mixerRef.current = animationsRef.current.length ? new THREE.AnimationMixer(object) : null;
        activeActionRef.current = null;
        if (mixerRef.current) {
          const initialClip = animationsRef.current[selectedClipIndex] || animationsRef.current[0];
          const initialAction = mixerRef.current.clipAction(initialClip);
          initialAction.enabled = true;
          initialAction.setEffectiveTimeScale(playbackSpeed);
          initialAction.paused = !isPlaying;
          initialAction.play();
          activeActionRef.current = initialAction;
        }
        centerAndFitCamera(object);
        applyRenderMode(renderMode);
        onModelLoaded?.({ modelId: currentFile.id, object, exportObject, animations: animationsRef.current, stats, metadata });
        setLoading(false);
        setLoadProgress(null);
      } catch (loadError) {
        if (cancelled || abortController.signal.aborted) return;
        releaseCurrentModel();
        const message = loadError instanceof Error ? loadError.message : 'Error al procesar el archivo 3D.';
        setError(message);
        setLoading(false);
        setLoadProgress(null);
        onModelError?.(message);
      } finally {
        revokeBlobUrl(modelUrl);
      }
    };

    void loadModel();
    return () => {
      cancelled = true;
      abortController.abort();
      if (loadAbortRef.current === abortController) loadAbortRef.current = null;
    };
  // Reload on model changes, explicit retries, or a newly recovered WebGL surface.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentFile?.id, retryNonce, rendererGeneration]);

  useEffect(() => {
    applyRenderMode(renderMode);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [renderMode]);

  useEffect(() => {
    if (gridHelperRef.current) gridHelperRef.current.visible = showGrid;
    if (axesHelperRef.current) axesHelperRef.current.visible = showAxes;
    if (controlsRef.current) {
      controlsRef.current.autoRotate = autoRotate;
      controlsRef.current.autoRotateSpeed = 1.6;
    }
    invalidateViewport();
  }, [showGrid, showAxes, autoRotate]);

  useEffect(() => {
    const mixer = mixerRef.current;
    const clips = animationsRef.current;
    if (!mixer || !clips.length) return;

    const clip = clips[selectedClipIndex] || clips[0];
    if (activeActionRef.current?.getClip() !== clip) {
      mixer.stopAllAction();
      const action = mixer.clipAction(clip);
      action.reset();
      action.enabled = true;
      action.setEffectiveTimeScale(playbackSpeed);
      action.paused = !isPlaying;
      action.play();
      activeActionRef.current = action;
    } else {
      activeActionRef.current.setEffectiveTimeScale(playbackSpeed);
      activeActionRef.current.paused = !isPlaying;
      if (isPlaying) activeActionRef.current.play();
    }
    invalidateViewport();
  }, [selectedClipIndex, isPlaying, playbackSpeed, currentFile?.id]);

  useEffect(() => {
    const action = activeActionRef.current;
    if (!action || !seekRequest) return;
    const duration = action.getClip().duration;
    action.time = THREE.MathUtils.clamp(seekRequest.value, 0, 1) * duration;
    mixerRef.current?.update(0);
    onAnimationProgress?.(THREE.MathUtils.clamp(seekRequest.value, 0, 1));
    invalidateViewport();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seekRequest]);

  useEffect(() => {
    if (!cameraPresetRequest || !currentModelRef.current || !cameraRef.current || !controlsRef.current) return;
    const bounds = new THREE.Box3().setFromObject(currentModelRef.current);
    const size = bounds.getSize(new THREE.Vector3());
    const distance = Math.max(size.length() * 0.9, 2);
    const target = controlsRef.current.target;
    const camera = cameraRef.current;

    if (cameraPresetRequest.preset === 'front') camera.position.set(target.x, target.y, target.z + distance);
    if (cameraPresetRequest.preset === 'top') camera.position.set(target.x, target.y + distance, target.z + 0.001);
    if (cameraPresetRequest.preset === 'side') camera.position.set(target.x + distance, target.y, target.z);
    if (cameraPresetRequest.preset === 'iso') camera.position.set(target.x + distance, target.y + distance, target.z + distance);
    camera.lookAt(target);
    controlsRef.current.update();
    updateCameraEvidence(containerRef.current, camera, controlsRef.current);
    invalidateViewport();
  }, [cameraPresetRequest]);

  useEffect(() => {
    if (!cameraControlRequest || !cameraRef.current || !controlsRef.current) return;
    const action = typeof cameraControlRequest.action === 'string' ? cameraControlRequest.action : '';
    if (applyCameraAction(cameraRef.current, controlsRef.current, action)) {
      updateCameraEvidence(containerRef.current, cameraRef.current, controlsRef.current);
      invalidateViewport();
    }
  }, [cameraControlRequest]);

  useEffect(() => {
    if (resetCameraRequest && currentModelRef.current) centerAndFitCamera(currentModelRef.current);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetCameraRequest]);

  useEffect(() => {
    if (!nodeVisibilityToggle || !currentModelRef.current) return;
    currentModelRef.current.traverse((child) => {
      if (child.uuid === nodeVisibilityToggle.uuid) child.visible = nodeVisibilityToggle.visible;
    });
    invalidateViewport();
  }, [nodeVisibilityToggle]);

  useEffect(() => {
    if (!snapshotRequest || !rendererRef.current || !sceneRef.current || !cameraRef.current) return;
    let cancelled = false;
    const capture = async () => {
      if (snapshotInProgressRef.current) {
        onSnapshotResult?.('Ya hay una captura en curso.');
        return;
      }
      snapshotInProgressRef.current = true;
      try {
        const renderer = rendererRef.current;
        const sourceWidth = Math.max(renderer.domElement.width, 1);
        const sourceHeight = Math.max(renderer.domElement.height, 1);
        const scale = Math.min(1, 1920 / Math.max(sourceWidth, sourceHeight));
        const width = Math.max(1, Math.round(sourceWidth * scale));
        const height = Math.max(1, Math.round(sourceHeight * scale));
        const target = new THREE.WebGLRenderTarget(width, height, { format: THREE.RGBAFormat, type: THREE.UnsignedByteType });
        const pixels = new Uint8Array(width * height * 4);
        try {
          renderer.setRenderTarget(target);
          renderer.render(sceneRef.current, cameraRef.current);
          renderer.readRenderTargetPixels(target, 0, 0, width, height, pixels);
        } finally {
          renderer.setRenderTarget(null);
          target.dispose();
        }
        if (cancelled) return;

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext('2d');
        if (!context) throw new Error('No se pudo preparar la captura.');
        const imageData = context.createImageData(width, height);
        for (let row = 0; row < height; row += 1) {
          const source = (height - row - 1) * width * 4;
          imageData.data.set(pixels.subarray(source, source + width * 4), row * width * 4);
        }
        context.putImageData(imageData, 0, 0);
        const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
        if (!blob) throw new Error('No se pudo codificar la captura PNG.');
        const objectUrl = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = objectUrl;
        link.download = `NexoIP3D_${safeDownloadName(currentFile?.name)}.png`;
        link.click();
        window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
        onSnapshotResult?.(null);
      } catch (snapshotError) {
        onSnapshotResult?.(snapshotError instanceof Error ? snapshotError.message : 'No se pudo guardar la captura.');
      } finally {
        snapshotInProgressRef.current = false;
      }
    };
    void capture();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshotRequest]);

  useEffect(() => {
    const dialog = errorDialogRef.current;
    if (!dialog) return;
    const visibleError = rendererError || error;
    if (visibleError && !dialog.open) dialog.showModal();
    if (!visibleError && dialog.open) dialog.close();
  }, [error, rendererError]);

  const dismissError = () => {
    if (contextLost) return;
    setError(null);
    onChooseAnotherModel?.();
  };

  return (
    <section className="relative h-full w-full bg-black" aria-label="Lienzo de modelo 3D" aria-busy={loading}>
      <div
        ref={containerRef}
        className="h-full w-full cursor-grab bg-black active:cursor-grabbing"
        data-viewport-controls
        role="group"
        tabIndex="0"
        aria-label="Vista 3D interactiva"
        aria-describedby="viewport-keyboard-help"
        onKeyDown={(event) => {
          const direction = {
            ArrowLeft: 'left',
            ArrowRight: 'right',
            ArrowUp: 'up',
            ArrowDown: 'down'
          }[event.key];
          if (!direction) return;
          const action = `${event.shiftKey ? 'orbit' : 'pan'}-${direction}`;
          if (applyCameraAction(cameraRef.current, controlsRef.current, action)) {
            updateCameraEvidence(containerRef.current, cameraRef.current, controlsRef.current);
            invalidateViewport();
            event.preventDefault();
          }
        }}
      />
      <p id="viewport-keyboard-help" className="sr-only">Usa las flechas para desplazar la cámara y Mayús más flechas para orbitar. Utiliza los controles de cámara para acercar o alejar.</p>

      {loading && (
        <div className="pointer-events-none absolute inset-0 z-30 flex flex-col items-center justify-center gap-3 bg-black/70 p-6 text-center backdrop-blur-sm" role="status" aria-live="polite">
          <RefreshCw size={38} aria-hidden="true" className="animate-spin text-amber-400" />
          <p className="text-sm font-semibold text-gray-100">Cargando objeto 3D…</p>
          {loadProgress !== null && <progress className="h-2 w-56 accent-amber-400" value={loadProgress} max="1">{Math.round(loadProgress * 100)}%</progress>}
        </div>
      )}

      <dialog
        ref={errorDialogRef}
        className="m-auto max-w-lg rounded-2xl border border-red-400/60 bg-red-950/95 p-0 text-center text-red-100 shadow-2xl backdrop:bg-black/80"
        aria-labelledby="model-error-title"
        aria-describedby="model-error-description"
        onCancel={(event) => {
          event.preventDefault();
          dismissError();
        }}
      >
        <div className="flex flex-col items-center p-7">
          <AlertTriangle size={48} aria-hidden="true" className="mb-3 text-red-400" />
          <h2 id="model-error-title" className="mb-1 text-lg font-bold text-red-100">
            {contextLost ? 'No se pudo iniciar la vista 3D' : 'No se pudo abrir el archivo 3D'}
          </h2>
          <p id="model-error-description" className="max-w-md text-sm text-red-100">{rendererError || error || 'Error de renderizado.'}</p>
          <div className="mt-5 flex flex-wrap justify-center gap-3">
            <button type="button" autoFocus onClick={() => {
              if (contextLost) {
                setRendererGeneration((value) => value + 1);
              } else {
                setError(null);
                setRetryNonce((value) => value + 1);
              }
            }} className="min-h-10 rounded-lg border border-red-300/60 px-4 py-2 text-sm font-semibold text-white hover:bg-red-900/50">
              {contextLost ? 'Recuperar vista' : 'Reintentar'}
            </button>
            {!contextLost && (
              <button type="button" onClick={dismissError} className="min-h-10 rounded-lg border border-white/30 px-4 py-2 text-sm font-semibold text-white hover:bg-white/10">
                Elegir otro modelo
              </button>
            )}
          </div>
        </div>
      </dialog>

      {!currentFile && !loading && (
        <div className="pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center p-6 text-center">
          <div className="glass-panel max-w-md space-y-4 rounded-3xl border border-white/10 p-8 shadow-2xl">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl border border-amber-500/30 bg-amber-600/20 text-amber-300">
              <UploadCloud size={32} aria-hidden="true" />
            </div>
            <div>
              <h2 className="mb-1 text-xl font-bold text-white">NexoIP 3D Viewer</h2>
              <p className="text-xs leading-relaxed text-gray-300">Selecciona un modelo de la biblioteca o abre un archivo local compatible.</p>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
