<div align="center">

# FlowRig: Unified Skeleton Generation for 3D and 4D Meshes via Flow Matching

[Fengzhi Guo](https://percool.github.io/) &emsp; Nate Morrill &emsp; [Shiqi Li](https://shi-qi-li.github.io/) &emsp; [Cheng Zhang](https://czhang0528.github.io/)

Texas A&M University

<!-- TODO: the arXiv badge points to a placeholder until the paper is public -->
[![arXiv](https://img.shields.io/badge/arXiv-Paper-b31b1b?logo=arxiv&logoColor=white)](https://www.google.com/)
[![Website](https://img.shields.io/badge/Project-Website-00947e?logo=googlechrome&logoColor=white)](https://tamu-visual-ai.github.io/FlowRig/)

</div>

Automatic rigging is a fundamental task for both static 3D and dynamic 4D mesh animation. We propose **FlowRig**, a template-free and data-efficient framework for unified 3D and 4D skeleton generation. Built on flow matching, FlowRig generates temporally aligned skeletons for an entire sequence in a single feedforward pass, while naturally handling single-mesh 3D rigging. The model further supports explicit skeleton-count control, uncertainty estimation for candidate selection, and masking-based interpolation, forecasting, and backcasting.

<!-- GIFs from static/readme/, made by skt/mytool/export_readme_gifs.py in the main code repo -->
## In-the-Wild

Real [DAVIS](https://davischallenge.org/) videos lifted to 4D meshes by [ActionMesh](https://remysabathier.github.io/actionmesh/), rigged by FlowRig.

<p align="center">
  <img src="static/readme/in_the_wild_bear.gif" width="32%" alt="Bear">
  <img src="static/readme/in_the_wild_hike.gif" width="32%" alt="Hike">
  <img src="static/readme/in_the_wild_flamingo.gif" width="32%" alt="Flamingo">
</p>

## Dynamic Reconstruction

Skeletons for animated meshes.

<p align="center">
  <img src="static/readme/dynamic_monkey.gif" width="32%" alt="Monkey">
  <img src="static/readme/dynamic_dancer.gif" width="32%" alt="Dancer">
  <img src="static/readme/dynamic_elephant.gif" width="32%" alt="Elephant">
</p>

## Static Reconstruction

Skeletons for static meshes from Diverse Pose, ModelsResource, and Articulation-XL2.0.

<p align="center">
  <img src="static/readme/static_turtle.gif" width="32%" alt="Turtle">
  <img src="static/readme/static_deer.gif" width="32%" alt="Deer">
  <img src="static/readme/static_dinosaur.gif" width="32%" alt="Dinosaur">
</p>

## Website

The project website can be accessed from this [link](https://tamu-visual-ai.github.io/FlowRig/). The website template is modified from [NeRFies](https://nerfies.github.io/) and [Birth and Death of a Rose](https://chen-geng.com/rose4d).

## Website License

<a rel="license" href="http://creativecommons.org/licenses/by-sa/4.0/"><img alt="Creative Commons License" style="border-width:0" src="https://i.creativecommons.org/l/by-sa/4.0/88x31.png" /></a><br />This work is licensed under a <a rel="license" href="http://creativecommons.org/licenses/by-sa/4.0/">Creative Commons Attribution-ShareAlike 4.0 International License</a>.
