import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { PLYLoader } from 'three/examples/jsm/loaders/PLYLoader.js';
import { ColladaLoader } from 'three/examples/jsm/loaders/ColladaLoader.js';
import { getFileExtension, SUPPORTED_MODEL_EXTENSIONS } from './nexoip.js';

// Configurar decodificador Draco para GLB/GLTF comprimidos
const dracoLoader = new DRACOLoader();
dracoLoader.setDecoderPath(`${import.meta.env.BASE_URL}draco/`);
dracoLoader.setDecoderConfig({ type: 'js' });

const gltfLoader = new GLTFLoader();
gltfLoader.setDRACOLoader(dracoLoader);

const objLoader = new OBJLoader();
const stlLoader = new STLLoader();
const fbxLoader = new FBXLoader();
const plyLoader = new PLYLoader();
const colladaLoader = new ColladaLoader();

/**
 * Carga un modelo 3D desde una URL o un archivo de Blob local.
 * Soporta .glb, .gltf, .obj, .stl, .fbx, .ply, .dae
 */
export async function load3DModel(url, fileName = '', onProgress) {
  const ext = getFileExtension(fileName || url);
  if (!ext) {
    throw new Error(`Formato no soportado. Soportados: ${SUPPORTED_MODEL_EXTENSIONS.map((item) => item.toUpperCase()).join(', ')}.`);
  }

  const progressHandler = (event) => {
    if (!onProgress || !event?.lengthComputable) return;
    onProgress(Math.max(0, Math.min(1, event.loaded / event.total)));
  };
  
  let sceneGroup = new THREE.Group();
  let animations = [];

  switch (ext) {
    case 'glb':
    case 'gltf': {
      const gltf = await gltfLoader.loadAsync(url, progressHandler);
      sceneGroup = gltf.scene || gltf.scenes[0];
      animations = gltf.animations || [];
      break;
    }
    case 'obj': {
      sceneGroup = await objLoader.loadAsync(url, progressHandler);
      break;
    }
    case 'stl': {
      const geometry = await stlLoader.loadAsync(url, progressHandler);
      geometry.computeVertexNormals();
      const material = createDefaultPBRMaterial(0x6366f1, 'STL Model');
      const mesh = new THREE.Mesh(geometry, material);
      mesh.name = fileName || 'STL_Mesh';
      sceneGroup.add(mesh);
      break;
    }
    case 'fbx': {
      const fbxGroup = await fbxLoader.loadAsync(url, progressHandler);
      sceneGroup = fbxGroup;
      animations = fbxGroup.animations || [];
      break;
    }
    case 'ply': {
      const geometry = await plyLoader.loadAsync(url, progressHandler);
      geometry.computeVertexNormals();
      const hasColors = geometry.attributes.color !== undefined;
      const material = hasColors
        ? new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.4, metalness: 0.1 })
        : createDefaultPBRMaterial(0x10b981, 'PLY Model');
      const mesh = new THREE.Mesh(geometry, material);
      mesh.name = fileName || 'PLY_Mesh';
      sceneGroup.add(mesh);
      break;
    }
    case 'dae': {
      const collada = await colladaLoader.loadAsync(url, progressHandler);
      sceneGroup = collada.scene;
      animations = collada.animations || [];
      break;
    }
    default:
      throw new Error(`Formato .${ext} no soportado.`);
  }

  // Normalizar la escena, asegurar cálculo de normales y sombras
  sceneGroup.traverse((child) => {
    if (child.isMesh) {
      child.castShadow = true;
      child.receiveShadow = true;

      // Si la malla no tiene un material PBR adecuado, asignarle uno por defecto
      if (!child.material) {
        child.material = createDefaultPBRMaterial(0x9ca3af, child.name);
      }
    }
  });

  // Extraer estadísticas e información detallada
  const stats = extractModelStats(sceneGroup, animations);

  return {
    object: sceneGroup,
    animations,
    stats,
    extension: ext
  };
}

/** Libera los recursos de GPU asignados por un modelo antes de cargar otro. */
export function disposeModelResources(rootObject) {
  if (!rootObject) return;

  const disposedGeometries = new Set();
  const disposedMaterials = new Set();
  const disposedTextures = new Set();

  const disposeTexture = (value) => {
    if (value?.isTexture && !disposedTextures.has(value)) {
      disposedTextures.add(value);
      value.dispose();
    }
  };

  rootObject.traverse((child) => {
    if (child.geometry && !disposedGeometries.has(child.geometry)) {
      disposedGeometries.add(child.geometry);
      child.geometry.dispose();
    }

    const materials = child.material
      ? (Array.isArray(child.material) ? child.material : [child.material])
      : [];
    materials.forEach((material) => {
      if (!material || disposedMaterials.has(material)) return;
      disposedMaterials.add(material);
      Object.values(material).forEach(disposeTexture);
      material.dispose();
    });
  });
}

function createDefaultPBRMaterial(colorHex, name = 'Material') {
  return new THREE.MeshStandardMaterial({
    color: colorHex,
    roughness: 0.35,
    metalness: 0.25,
    side: THREE.DoubleSide,
    name: `${name}_Material`
  });
}

/**
 * Calcula estadísticas detalladas del modelo:
 * Vértices, Polígonos/Triángulos, Mallas, Bounding Box (X, Y, Z), Jerarquía de Nodos y Materiales.
 */
export function extractModelStats(rootObject, animations = []) {
  let totalVertices = 0;
  let totalTriangles = 0;
  let totalMeshes = 0;
  const materialsMap = new Map();

  const bbox = new THREE.Box3().setFromObject(rootObject);
  const size = new THREE.Vector3();
  bbox.getSize(size);
  const center = new THREE.Vector3();
  bbox.getCenter(center);

  rootObject.traverse((child) => {
    if (child.isMesh) {
      totalMeshes++;
      const geometry = child.geometry;

      if (geometry) {
        if (geometry.index) {
          totalTriangles += geometry.index.count / 3;
        } else if (geometry.attributes.position) {
          totalTriangles += geometry.attributes.position.count / 3;
        }

        if (geometry.attributes.position) {
          totalVertices += geometry.attributes.position.count;
        }
      }

      if (child.material) {
        const mats = Array.isArray(child.material) ? child.material : [child.material];
        mats.forEach(mat => {
          if (!materialsMap.has(mat.uuid)) {
            materialsMap.set(mat.uuid, {
              id: mat.uuid,
              name: mat.name || 'Sin Nombre',
              type: mat.type,
              color: mat.color ? '#' + mat.color.getHexString() : '#ffffff',
              roughness: mat.roughness !== undefined ? mat.roughness : null,
              metalness: mat.metalness !== undefined ? mat.metalness : null,
              wireframe: !!mat.wireframe,
              transparent: !!mat.transparent,
              opacity: mat.opacity !== undefined ? mat.opacity : 1.0,
              map: !!mat.map
            });
          }
        });
      }
    }
  });

  const hierarchy = buildHierarchyTree(rootObject);

  return {
    vertices: Math.round(totalVertices),
    triangles: Math.round(totalTriangles),
    meshes: totalMeshes,
    dimensions: {
      x: Number(size.x.toFixed(3)),
      y: Number(size.y.toFixed(3)),
      z: Number(size.z.toFixed(3)),
      unit: 'm'
    },
    center: {
      x: Number(center.x.toFixed(3)),
      y: Number(center.y.toFixed(3)),
      z: Number(center.z.toFixed(3))
    },
    materials: Array.from(materialsMap.values()),
    animationsCount: animations.length,
    animationNames: animations.map(a => a.name || 'Animación Sin Nombre'),
    hierarchy
  };
}

function buildHierarchyTree(obj) {
  const node = {
    uuid: obj.uuid,
    name: obj.name || (obj.isMesh ? 'Malla' : obj.type),
    type: obj.type,
    isMesh: !!obj.isMesh,
    visible: obj.visible,
    children: []
  };

  if (obj.children && obj.children.length > 0) {
    node.children = obj.children.map(child => buildHierarchyTree(child));
  }

  return node;
}
